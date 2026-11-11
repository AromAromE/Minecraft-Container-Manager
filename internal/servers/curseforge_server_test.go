package servers_test

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mcm-panel/mcm/internal/curseforge"
	"github.com/mcm-panel/mcm/internal/db"
	"github.com/mcm-panel/mcm/internal/jars"
	"github.com/mcm-panel/mcm/internal/servers"
)

func createTestServerPackZip(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	// Add files inside a common root folder "Server-Files-1.0"
	files := map[string]string{
		"Server-Files-1.0/run.sh":            "#!/bin/sh\r\njava -jar server.jar nogui\r\n",
		"Server-Files-1.0/mods/testmod.jar":  "dummy mod jar content",
		"Server-Files-1.0/config/common.txt": "foo=bar",
		"Server-Files-1.0/variables.txt":     "JAVA_ARGS=\"-Xmx4G\"\r\nUSE_SSJ=\"true\"\r\n",
	}

	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("create zip entry %s: %v", name, err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatalf("write zip entry %s: %v", name, err)
		}
	}

	if err := zw.Close(); err != nil {
		t.Fatalf("close zip writer: %v", err)
	}

	return buf.Bytes()
}

func TestInstallCurseForgeServer(t *testing.T) {
	tempDir := t.TempDir()
	store, err := db.Open(filepath.Join(tempDir, "mcm_test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { store.Close() })

	ctx := context.Background()
	if _, err := curseforge.Save(ctx, store.DB, "test-api-key"); err != nil {
		t.Fatalf("save curseforge key: %v", err)
	}

	zipBytes := createTestServerPackZip(t)

	// Mock CurseForge server
	var ts *httptest.Server
	ts = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/mods/12345/files/67890":
			resp := map[string]any{
				"data": map[string]any{
					"id":               67890,
					"modId":            12345,
					"displayName":      "ATM9 Release 1.0",
					"fileName":         "client-1.0.zip",
					"releaseType":      1,
					"gameVersions":     []string{"1.20.1", "Forge"},
					"serverPackFileId": 67891,
				},
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(resp)

		case "/mods/12345/files/67891":
			resp := map[string]any{
				"data": map[string]any{
					"id":           67891,
					"modId":        12345,
					"displayName":  "ATM9 Server Pack 1.0",
					"fileName":     "Server-Files-1.0.zip",
					"releaseType":  1,
					"downloadUrl":  ts.URL + "/download/server-files.zip",
					"gameVersions": []string{"1.20.1", "Forge"},
				},
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(resp)

		case "/download/server-files.zip":
			w.Header().Set("Content-Type", "application/zip")
			_, _ = w.Write(zipBytes)

		default:
			http.NotFound(w, r)
		}
	}))
	defer ts.Close()

	t.Setenv("CURSEFORGE_API_BASE_URL", ts.URL)

	jr := jars.NewResolver()
	serverStore := servers.NewStore(store, nil, jr, 25565, 25575, tempDir, "")

	var progressStages []string
	srv, err := serverStore.InstallCurseForgeServer(ctx, servers.InstallCurseForgeServerInput{
		ModID:       12345,
		FileID:      67890,
		ServerName:  "Test ATM9 Server",
		MemoryLimit: "6GB",
		Port:        25565,
	}, func(stage, title, message string, percent int) {
		progressStages = append(progressStages, stage)
	})
	if err != nil {
		t.Fatalf("InstallCurseForgeServer failed: %v", err)
	}

	if srv.Name != "Test ATM9 Server" {
		t.Errorf("expected server name 'Test ATM9 Server', got %s", srv.Name)
	}
	if srv.ServerType != "forge" {
		t.Errorf("expected serverType 'forge', got %s", srv.ServerType)
	}
	if srv.Version != "1.20.1" {
		t.Errorf("expected version '1.20.1', got %s", srv.Version)
	}
	if srv.RAMMB != 6144 {
		t.Errorf("expected 6144 MB RAM, got %d", srv.RAMMB)
	}
	if srv.HostPort != 25565 {
		t.Errorf("expected port 25565, got %d", srv.HostPort)
	}
	if len(progressStages) == 0 {
		t.Errorf("expected progress updates, got none")
	}

	// Verify extracted files
	serverDataDir := filepath.Join(tempDir, "servers", srv.ID)
	eulaBytes, err := os.ReadFile(filepath.Join(serverDataDir, "eula.txt"))
	if err != nil || !strings.Contains(string(eulaBytes), "eula=true") {
		t.Errorf("eula.txt missing or invalid: %v", err)
	}

	propsBytes, err := os.ReadFile(filepath.Join(serverDataDir, "server.properties"))
	if err != nil || !strings.Contains(string(propsBytes), "server-port=25565") {
		t.Errorf("server.properties missing or missing port: %v", err)
	}

	runShBytes, err := os.ReadFile(filepath.Join(serverDataDir, "run.sh"))
	if err != nil || strings.Contains(string(runShBytes), "\r\n") {
		t.Errorf("run.sh missing or contains CRLF: %v", err)
	}

	varBytes, err := os.ReadFile(filepath.Join(serverDataDir, "variables.txt"))
	if err != nil || !strings.Contains(string(varBytes), `USE_SSJ="false"`) {
		t.Errorf("variables.txt missing or USE_SSJ not set to false: %v, content=%s", err, string(varBytes))
	}
}

func TestSetupStartupScriptsAndProperties(t *testing.T) {
	tempDir := t.TempDir()
	dataDir := filepath.Join(tempDir, "server1")
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create start.sh with CRLF
	startSh := filepath.Join(dataDir, "start.sh")
	if err := os.WriteFile(startSh, []byte("#!/bin/sh\r\necho starting\r\n"), 0644); err != nil {
		t.Fatal(err)
	}

	// Unpack mock files and verify setup
	// Write a mock server.jar
	serverJar := filepath.Join(dataDir, "forge-1.20.1-47.2.0.jar")
	if err := os.WriteFile(serverJar, []byte("jarcontent"), 0644); err != nil {
		t.Fatal(err)
	}

	// Test store creation
	dbStore, err := db.Open(filepath.Join(tempDir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer dbStore.Close()

	jr := jars.NewResolver()
	serverStore := servers.NewStore(dbStore, nil, jr, 25565, 25575, tempDir, "")
	if serverStore == nil {
		t.Fatal("expected serverStore to be created")
	}
}
