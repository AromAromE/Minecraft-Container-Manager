package servers

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mcm-panel/mcm/internal/curseforge"
	"github.com/mcm-panel/mcm/internal/jars"
	"github.com/mcm-panel/mcm/internal/storage"
)

// InstallCurseForgeServerInput defines the parameters for deploying a CurseForge server pack.
type InstallCurseForgeServerInput struct {
	ModID       int    `json:"modId"`
	FileID      int    `json:"fileId"`
	ServerName  string `json:"serverName"`
	MemoryLimit string `json:"memoryLimit"`
	Port        int    `json:"port"`
}

// ProgressCallback is invoked during server pack installation to report progress.
type ProgressCallback func(stage, title, message string, percent int)

var mcVerRegex = regexp.MustCompile(`^1\.\d+(\.\d+)?$`)

// ParseMemoryLimit parses strings like "4GB", "6G", "4096MB", "8192", "4" into MB.
func ParseMemoryLimit(limit string) int {
	clean := strings.TrimSpace(strings.ToUpper(limit))
	if clean == "" {
		return 4096
	}
	clean = strings.ReplaceAll(clean, " ", "")
	if strings.HasSuffix(clean, "GB") || strings.HasSuffix(clean, "G") {
		numStr := strings.TrimSuffix(strings.TrimSuffix(clean, "GB"), "G")
		if n, err := strconv.Atoi(numStr); err == nil && n > 0 {
			return n * 1024
		}
	}
	if strings.HasSuffix(clean, "MB") || strings.HasSuffix(clean, "M") {
		numStr := strings.TrimSuffix(strings.TrimSuffix(clean, "MB"), "M")
		if n, err := strconv.Atoi(numStr); err == nil && n > 0 {
			return n
		}
	}
	if n, err := strconv.Atoi(clean); err == nil && n > 0 {
		if n <= 64 { // likely specified in gigabytes
			return n * 1024
		}
		return n
	}
	return 4096
}

// InstallCurseForgeServer downloads and deploys a CurseForge modpack server container.
func (s *Store) InstallCurseForgeServer(ctx context.Context, in InstallCurseForgeServerInput, onProgress ProgressCallback) (Server, error) {
	if in.ModID <= 0 || in.FileID <= 0 {
		return Server{}, errors.New("modId and fileId are required")
	}

	report := func(stage, title, message string, percent int) {
		if onProgress != nil {
			onProgress(stage, title, message, percent)
		}
	}

	report("resolving", "Resolving Server Pack", "Querying CurseForge file metadata...", 5)

	// Fetch API key
	apiKey, err := curseforge.APIKey(ctx, s.db)
	if err != nil {
		return Server{}, fmt.Errorf("read CurseForge settings: %w", err)
	}
	if apiKey == "" {
		return Server{}, curseforge.ErrNotConfigured
	}

	cfClient := curseforge.NewClient(apiKey)

	// 1. Query CurseForge file details
	file, err := cfClient.GetFile(ctx, in.ModID, in.FileID)
	if err != nil {
		return Server{}, fmt.Errorf("fetch CurseForge file details: %w", err)
	}

	targetFileID := in.FileID
	if file.ServerPackFileID > 0 {
		targetFileID = file.ServerPackFileID
		// Try fetching server pack file metadata for fileName and download URL
		if spFile, err := cfClient.GetFile(ctx, in.ModID, targetFileID); err == nil && spFile != nil {
			file = spFile
		}
	}

	// 2. Resolve download URL
	report("resolving_url", "Resolving Download URL", "Fetching server pack download URL...", 15)
	downloadURL := file.DownloadURL
	if downloadURL == "" {
		resolvedURL, err := cfClient.GetFileDownloadURL(ctx, in.ModID, targetFileID)
		if err == nil && resolvedURL != "" {
			downloadURL = resolvedURL
		}
	}
	if downloadURL == "" {
		return Server{}, fmt.Errorf("no download URL available for CurseForge file %d (modId %d): distribution may be restricted by modpack author", targetFileID, in.ModID)
	}

	// Determine MC version & Modloader
	mcVersion := "1.20.1"
	serverType := "forge"
	for _, gv := range file.GameVersions {
		if mcVerRegex.MatchString(gv) {
			mcVersion = gv
		}
		lower := strings.ToLower(gv)
		switch {
		case strings.Contains(lower, "neoforge"):
			serverType = "neoforge"
		case strings.Contains(lower, "fabric"):
			serverType = "fabric"
		case strings.Contains(lower, "quilt"):
			serverType = "quilt"
		case strings.Contains(lower, "forge"):
			serverType = "forge"
		}
	}

	javaVer := jars.RecommendJavaVersion(mcVersion)
	if javaVer <= 0 {
		javaVer = 21
	}

	ramMB := ParseMemoryLimit(in.MemoryLimit)
	serverName := strings.TrimSpace(in.ServerName)
	if serverName == "" {
		if file.DisplayName != "" {
			serverName = file.DisplayName
		} else {
			serverName = fmt.Sprintf("CurseForge Server %d", in.ModID)
		}
	}

	// Reserve Port
	s.portConfigMu.Lock()
	defer s.portConfigMu.Unlock()

	var port int
	if in.Port > 0 {
		if in.Port < 1 || in.Port > 65535 {
			return Server{}, errors.New("port must be between 1 and 65535")
		}
		if err := s.ensurePortFree(ctx, "", in.Port); err != nil {
			return Server{}, err
		}
		port = in.Port
	} else {
		var err error
		port, err = s.ports.Allocate(ctx)
		if err != nil {
			return Server{}, fmt.Errorf("allocate host port: %w", err)
		}
	}

	if err := s.validateProposedPorts(ctx, "", port, nil); err != nil {
		return Server{}, err
	}

	// 3 & 4. Download and unpack ZIP archive
	report("downloading", "Downloading Server Pack", "Downloading server pack archive from CurseForge...", 25)

	tmpZip, err := os.CreateTemp("", "mcm-curseforge-server-*.zip")
	if err != nil {
		return Server{}, fmt.Errorf("create temp download file: %w", err)
	}
	tmpZipPath := tmpZip.Name()
	defer func() {
		tmpZip.Close()
		_ = os.Remove(tmpZipPath)
	}()

	dlReq, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
	if err != nil {
		return Server{}, fmt.Errorf("build download request: %w", err)
	}
	dlReq.Header.Set("User-Agent", "mcm-panel/1.0 (https://github.com/mcm-panel/mcm)")
	dlResp, err := http.DefaultClient.Do(dlReq)
	if err != nil {
		return Server{}, fmt.Errorf("download server pack archive: %w", err)
	}
	defer dlResp.Body.Close()

	if dlResp.StatusCode != http.StatusOK {
		return Server{}, fmt.Errorf("server pack download returned HTTP %d", dlResp.StatusCode)
	}

	totalBytes := dlResp.ContentLength
	var downloaded int64
	pw := &progressWriter{
		w:     tmpZip,
		total: totalBytes,
		onProgress: func(done, total int64) {
			pct := 25
			if total > 0 {
				pct = 25 + int((float64(done)/float64(total))*35.0) // 25% -> 60%
			}
			msg := fmt.Sprintf("Downloading server archive (%d MB)...", done/(1024*1024))
			report("downloading", "Downloading Server Pack", msg, pct)
		},
	}

	downloaded, err = io.Copy(pw, io.LimitReader(dlResp.Body, storage.MaxArchiveBytes))
	if err != nil {
		return Server{}, fmt.Errorf("save server pack archive: %w", err)
	}
	_ = tmpZip.Close()

	if downloaded <= 0 {
		return Server{}, errors.New("downloaded archive is empty")
	}

	zr, err := zip.OpenReader(tmpZipPath)
	if err != nil {
		return Server{}, fmt.Errorf("read server pack zip archive: %w", err)
	}
	defer zr.Close()

	if len(zr.File) == 0 {
		return Server{}, errors.New("server pack archive contains no files")
	}
	if len(zr.File) > storage.MaxArchiveEntries {
		return Server{}, errors.New("server pack archive exceeds maximum allowed entry count")
	}

	report("extracting", "Extracting Server Files", "Unpacking files into server directory...", 65)

	serverID := uuid.NewString()
	dataDir := s.dataPath(serverID)
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return Server{}, fmt.Errorf("create server directory: %w", err)
	}

	published := false
	defer func() {
		if !published {
			_ = os.RemoveAll(dataDir)
		}
	}()

	root, err := storage.OpenServer(s.dataDir, serverID)
	if err != nil {
		return Server{}, fmt.Errorf("open server root: %w", err)
	}
	defer root.Close()

	// Detect if all files share a common single root folder
	rootPrefix := detectSingleRootFolder(zr.File)

	var extractedBytes int64
	for _, member := range zr.File {
		if err := ctx.Err(); err != nil {
			return Server{}, err
		}

		cleanPath := filepath.ToSlash(member.Name)
		cleanPath = strings.TrimPrefix(cleanPath, "/")
		if rootPrefix != "" {
			if cleanPath == rootPrefix || cleanPath == rootPrefix+"/" {
				continue
			}
			cleanPath = strings.TrimPrefix(cleanPath, rootPrefix+"/")
		}

		cleanName, err := storage.Clean(cleanPath)
		if err != nil || cleanName == "." {
			continue
		}

		if member.FileInfo().IsDir() {
			if err := root.MkdirAll(cleanName, 0755); err != nil {
				return Server{}, fmt.Errorf("create dir %s: %w", cleanName, err)
			}
			continue
		}

		// Ensure parent directory exists
		parent := path.Dir(cleanName)
		if parent != "." {
			if err := root.MkdirAll(parent, 0755); err != nil {
				return Server{}, fmt.Errorf("create parent dir %s: %w", parent, err)
			}
		}

		rc, err := member.Open()
		if err != nil {
			return Server{}, fmt.Errorf("open zip member %s: %w", cleanName, err)
		}

		perm := 0644 | (member.Mode().Perm() & 0111)
		n, err := storage.Write(ctx, root, cleanName, rc, storage.MaxArchiveBytes-extractedBytes, perm)
		rc.Close()
		extractedBytes += n
		if err != nil {
			return Server{}, fmt.Errorf("extract %s: %w", cleanName, err)
		}
	}

	// 5. Detect and configure startup scripts
	report("configuring", "Configuring Server Runtime", "Detecting startup scripts and EULA...", 75)
	setupStartupScripts(dataDir)

	// 6. Generate eula.txt and server.properties
	eulaPath := filepath.Join(dataDir, "eula.txt")
	_ = os.WriteFile(eulaPath, []byte("#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).\neula=true\n"), 0644)

	propsPath := filepath.Join(dataDir, "server.properties")
	configureServerProperties(propsPath, port, serverName)

	// 7. Insert DB record and spawn Docker container
	report("provisioning", "Provisioning Container", "Spawning container runtime...", 88)

	now := time.Now().UTC().Format(time.RFC3339)
	for attempt := 0; attempt < 20; attempt++ {
		_, err = s.db.ExecContext(ctx,
			`INSERT INTO servers (id, name, server_type, version, build, ram_mb, cpu_limit, memory_limit_mb, host_port, extra_ports, container_id, state, created_at, updated_at, java_version) VALUES (?, ?, ?, ?, '', ?, 0, ?, ?, '[]', '', ?, ?, ?, ?)`,
			serverID, serverName, serverType, mcVersion, ramMB, ramMB, port, StateStopped, now, now, javaVer)
		if err == nil {
			break
		}
		if !isPortReservationError(err) {
			return Server{}, fmt.Errorf("insert server record: %w", err)
		}
		port, err = s.ports.Allocate(ctx)
		if err != nil {
			return Server{}, err
		}
		configureServerProperties(propsPath, port, serverName)
	}
	if err != nil {
		return Server{}, fmt.Errorf("%w: repeated reservation conflicts", ErrPortInUse)
	}

	defer func() {
		if !published {
			cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancel()
			_, _ = s.db.ExecContext(cleanupCtx, `DELETE FROM servers WHERE id=?`, serverID)
		}
	}()

	if err := s.createBackupSchedule(ctx, serverID); err != nil {
		return Server{}, fmt.Errorf("create backup schedule: %w", err)
	}

	createdSrv, err := s.Get(ctx, serverID)
	if err != nil {
		return Server{}, err
	}

	if !isDockerNil(s.docker) {
		report("provisioning", "Creating Docker Container", "Binding port and container environment...", 94)
		createdSrv, err = s.ensureContainer(ctx, createdSrv)
		if err != nil {
			return Server{}, fmt.Errorf("provision container: %w", err)
		}
	}

	published = true
	report("completed", "Deploy Complete", "Server container deployed successfully!", 100)
	return createdSrv, nil
}

func detectSingleRootFolder(files []*zip.File) string {
	var prefix string
	for _, f := range files {
		clean := strings.Trim(filepath.ToSlash(f.Name), "/")
		if clean == "" || clean == "." {
			continue
		}
		parts := strings.Split(clean, "/")
		if len(parts) <= 1 && !f.FileInfo().IsDir() {
			return ""
		}
		root := parts[0]
		if prefix == "" {
			prefix = root
		} else if prefix != root {
			return ""
		}
	}
	return prefix
}

func setupStartupScripts(dataDir string) {
	runSh := filepath.Join(dataDir, "run.sh")
	startSh := filepath.Join(dataDir, "start.sh")
	serverStartSh := filepath.Join(dataDir, "ServerStart.sh")
	launchSh := filepath.Join(dataDir, "launch.sh")

	// 1. If run.sh exists, normalize CRLF and make executable
	if _, err := os.Stat(runSh); err == nil {
		normalizeScriptFile(runSh)
		_ = os.Chmod(runSh, 0755)
	} else {
		// 2. If start.sh or ServerStart.sh exists, link or create run.sh wrapper
		var candidate string
		for _, alt := range []string{startSh, serverStartSh, launchSh} {
			if _, err := os.Stat(alt); err == nil {
				candidate = alt
				break
			}
		}
		if candidate != "" {
			normalizeScriptFile(candidate)
			_ = os.Chmod(candidate, 0755)
			baseName := filepath.Base(candidate)
			wrapperContent := fmt.Sprintf("#!/bin/sh\nexec ./%s \"$@\"\n", baseName)
			_ = os.WriteFile(runSh, []byte(wrapperContent), 0755)
		}
	}

	// 3. Forge installer or server jar linking
	installerJar := filepath.Join(dataDir, "installer.jar")
	if _, err := os.Stat(installerJar); os.IsNotExist(err) {
		if matches, _ := filepath.Glob(filepath.Join(dataDir, "*installer*.jar")); len(matches) > 0 {
			_ = copyOrLink(matches[0], installerJar)
		}
	}

	serverJar := filepath.Join(dataDir, "server.jar")
	if _, err := os.Stat(serverJar); os.IsNotExist(err) {
		// Link forge jar if exists
		if matches, _ := filepath.Glob(filepath.Join(dataDir, "*forge*.jar")); len(matches) > 0 {
			for _, m := range matches {
				if !strings.Contains(strings.ToLower(filepath.Base(m)), "installer") {
					_ = copyOrLink(m, serverJar)
					break
				}
			}
		}
		// Link fabric server jar if exists
		if matches, _ := filepath.Glob(filepath.Join(dataDir, "*fabric-server*.jar")); len(matches) > 0 {
			_ = copyOrLink(matches[0], serverJar)
		}
	}

	// 4. Normalize all .sh files in root directory
	entries, err := os.ReadDir(dataDir)
	if err == nil {
		for _, e := range entries {
			if !e.IsDir() && strings.HasSuffix(strings.ToLower(e.Name()), ".sh") {
				filePath := filepath.Join(dataDir, e.Name())
				normalizeScriptFile(filePath)
				_ = os.Chmod(filePath, 0755)
			}
		}
	}

	// 5. Bypass ServerStarterJar (SSJ) in ServerPackCreator modpacks.
	// Setting USE_SSJ="false" ensures the server starts directly using official Forge scripts
	// instead of the buggy fake server.jar wrapper.
	configureServerPackVariables(dataDir)
}

func configureServerPackVariables(dataDir string) {
	varPath := filepath.Join(dataDir, "variables.txt")
	data, err := os.ReadFile(varPath)
	if err != nil {
		return
	}
	content := string(data)
	content = strings.ReplaceAll(content, "\r\n", "\n")

	re := regexp.MustCompile(`(?m)^(\s*USE_SSJ\s*=\s*).*$`)
	if re.MatchString(content) {
		content = re.ReplaceAllString(content, `USE_SSJ="false"`)
	} else {
		content += "\nUSE_SSJ=\"false\"\n"
	}
	_ = os.WriteFile(varPath, []byte(content), 0644)
}

func normalizeScriptFile(filePath string) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return
	}
	content := string(data)
	if strings.Contains(content, "\r\n") {
		content = strings.ReplaceAll(content, "\r\n", "\n")
		_ = os.WriteFile(filePath, []byte(content), 0755)
	}
}

func copyOrLink(src, dest string) error {
	if err := os.Symlink(filepath.Base(src), dest); err == nil {
		return nil
	}
	// Fallback to copy if symlink unsupported
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func configureServerProperties(propsPath string, port int, serverName string) {
	portStr := strconv.Itoa(port)
	if data, err := os.ReadFile(propsPath); err == nil {
		lines := strings.Split(string(data), "\n")
		hasPort := false
		hasQueryPort := false
		for i, line := range lines {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "server-port=") {
				lines[i] = "server-port=" + portStr
				hasPort = true
			} else if strings.HasPrefix(trimmed, "query.port=") {
				lines[i] = "query.port=" + portStr
				hasQueryPort = true
			}
		}
		if !hasPort {
			lines = append(lines, "server-port="+portStr)
		}
		if !hasQueryPort {
			lines = append(lines, "query.port="+portStr)
		}
		_ = os.WriteFile(propsPath, []byte(strings.Join(lines, "\n")), 0644)
		return
	}

	content := fmt.Sprintf(`#Minecraft server properties
#Generated by MCM CurseForge Server Deployer
server-port=%d
query.port=%d
motd=%s
enable-query=true
max-players=20
online-mode=true
difficulty=easy
gamemode=survival
`, port, port, serverName)
	_ = os.WriteFile(propsPath, []byte(content), 0644)
}

type progressWriter struct {
	w          io.Writer
	total      int64
	done       int64
	onProgress func(done, total int64)
}

func (pw *progressWriter) Write(p []byte) (int, error) {
	n, err := pw.w.Write(p)
	if n > 0 {
		pw.done += int64(n)
		if pw.onProgress != nil {
			pw.onProgress(pw.done, pw.total)
		}
	}
	return n, err
}
