package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/mcm-panel/mcm/internal/curseforge"
	"github.com/mcm-panel/mcm/internal/ports"
	"github.com/mcm-panel/mcm/internal/servers"
)

// getCurseForgeClient resolves the active CurseForge API key and returns a configured client.
func (s *Server) getCurseForgeClient(r *http.Request) (*curseforge.Client, error) {
	var fallback string
	if s.cfg != nil {
		fallback = s.cfg.CurseForgeAPIKey
	}
	key, err := curseforge.APIKeyWithFallback(r.Context(), s.db.DB, fallback)
	if err != nil {
		return nil, err
	}
	if key == "" {
		return nil, curseforge.ErrNotConfigured
	}
	return curseforge.NewClient(key), nil
}

// handleCurseForgeModpacks proxies search requests to CurseForge modpacks catalog.
func (s *Server) handleCurseForgeModpacks(w http.ResponseWriter, r *http.Request) {
	cfClient, err := s.getCurseForgeClient(r)
	if err != nil {
		if errors.Is(err, curseforge.ErrNotConfigured) {
			writeError(w, http.StatusServiceUnavailable, "curseforge_not_configured", "configure a shared CurseForge API key in App Settings")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", "could not load CurseForge settings")
		return
	}

	q := r.URL.Query()
	filter := curseforge.ModpackFilter{
		SearchFilter: q.Get("searchFilter"),
		GameVersion:  q.Get("gameVersion"),
	}

	if val := q.Get("modLoaderType"); val != "" {
		if n, err := strconv.Atoi(val); err == nil {
			filter.ModLoaderType = n
		}
	}
	if val := q.Get("sortField"); val != "" {
		if n, err := strconv.Atoi(val); err == nil {
			filter.SortField = n
		}
	}
	if val := q.Get("sortOrder"); val != "" {
		filter.SortOrder = val
	}
	if val := q.Get("pageSize"); val != "" {
		if n, err := strconv.Atoi(val); err == nil {
			filter.PageSize = n
		}
	}
	if val := q.Get("index"); val != "" {
		if n, err := strconv.Atoi(val); err == nil {
			filter.Index = n
		}
	}
	if val := q.Get("categoryId"); val != "" {
		if n, err := strconv.Atoi(val); err == nil {
			filter.CategoryID = n
		}
	}

	res, err := cfClient.SearchModpacks(r.Context(), filter)
	if err != nil {
		if s.logger != nil {
			s.logger.Printf("[curseforge] search modpacks error: %v", err)
		}
		if errors.Is(err, curseforge.ErrUpstreamError) {
			writeError(w, http.StatusBadGateway, "upstream_error", err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, res)
}

// handleCurseForgeModpackFiles returns files for a modpack, highlighting if a serverPackFileId exists.
func (s *Server) handleCurseForgeModpackFiles(w http.ResponseWriter, r *http.Request) {
	cfClient, err := s.getCurseForgeClient(r)
	if err != nil {
		if errors.Is(err, curseforge.ErrNotConfigured) {
			writeError(w, http.StatusServiceUnavailable, "curseforge_not_configured", "configure a shared CurseForge API key in App Settings")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", "could not load CurseForge settings")
		return
	}

	modIDStr := r.PathValue("modId")
	modID, err := strconv.Atoi(modIDStr)
	if err != nil || modID <= 0 {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid modId parameter")
		return
	}

	q := r.URL.Query()
	gameVersion := q.Get("gameVersion")
	modLoaderType := 0
	if val := q.Get("modLoaderType"); val != "" {
		if n, err := strconv.Atoi(val); err == nil {
			modLoaderType = n
		}
	}
	pageSize := 25
	if val := q.Get("pageSize"); val != "" {
		if n, err := strconv.Atoi(val); err == nil {
			pageSize = n
		}
	}
	index := 0
	if val := q.Get("index"); val != "" {
		if n, err := strconv.Atoi(val); err == nil {
			index = n
		}
	}

	files, err := cfClient.GetModpackFiles(r.Context(), modID, gameVersion, modLoaderType, pageSize, index)
	if err != nil {
		if s.logger != nil {
			s.logger.Printf("[curseforge] get files error: %v", err)
		}
		if errors.Is(err, curseforge.ErrResourceNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "modpack files not found")
			return
		}
		if errors.Is(err, curseforge.ErrUpstreamError) {
			writeError(w, http.StatusBadGateway, "upstream_error", err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, files)
}

// handleCurseForgeCategories returns available modpack categories.
func (s *Server) handleCurseForgeCategories(w http.ResponseWriter, r *http.Request) {
	cfClient, err := s.getCurseForgeClient(r)
	if err != nil {
		if errors.Is(err, curseforge.ErrNotConfigured) {
			writeError(w, http.StatusServiceUnavailable, "curseforge_not_configured", "configure a shared CurseForge API key in App Settings")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", "could not load CurseForge settings")
		return
	}

	cats, err := cfClient.GetCategories(r.Context())
	if err != nil {
		if s.logger != nil {
			s.logger.Printf("[curseforge] get categories error: %v", err)
		}
		writeError(w, http.StatusBadGateway, "upstream_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"data": cats})
}

// handleCurseForgeInstallServer deploys a server pack container.
func (s *Server) handleCurseForgeInstallServer(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ModID       int    `json:"modId"`
		ModIDAlt    int    `json:"mod_id"`
		FileID      int    `json:"fileId"`
		FileIDAlt   int    `json:"file_id"`
		ServerName  string `json:"serverName"`
		ServerName2 string `json:"server_name"`
		ServerName3 string `json:"name"`
		MemoryLimit string `json:"memoryLimit"`
		MemoryLim2  string `json:"memory_limit"`
		RAMMB       int    `json:"ram_mb"`
		Port        int    `json:"port"`
		HostPort    int    `json:"host_port"`
	}

	if err := decodeJSON(w, r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "invalid JSON request body")
		return
	}

	modID := in.ModID
	if modID <= 0 {
		modID = in.ModIDAlt
	}
	fileID := in.FileID
	if fileID <= 0 {
		fileID = in.FileIDAlt
	}
	if modID <= 0 || fileID <= 0 {
		writeError(w, http.StatusBadRequest, "invalid_request", "modId and fileId are required")
		return
	}

	serverName := in.ServerName
	if serverName == "" {
		serverName = in.ServerName2
	}
	if serverName == "" {
		serverName = in.ServerName3
	}

	memLimit := in.MemoryLimit
	if memLimit == "" {
		memLimit = in.MemoryLim2
	}
	if memLimit == "" && in.RAMMB > 0 {
		memLimit = strconv.Itoa(in.RAMMB)
	}

	port := in.Port
	if port <= 0 {
		port = in.HostPort
	}

	deployInput := servers.InstallCurseForgeServerInput{
		ModID:       modID,
		FileID:      fileID,
		ServerName:  serverName,
		MemoryLimit: memLimit,
		Port:        port,
	}

	isStreaming := r.Header.Get("Accept") == "text/event-stream" || r.URL.Query().Get("stream") == "true"
	if isStreaming {
		flusher, ok := w.(http.Flusher)
		if !ok {
			writeError(w, http.StatusInternalServerError, "streaming_unsupported", "streaming is unsupported by server")
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")

		progressFn := func(stage, title, message string, percent int) {
			payload, _ := json.Marshal(map[string]any{
				"stage":   stage,
				"title":   title,
				"message": message,
				"percent": percent,
			})
			fmt.Fprintf(w, "event: progress\ndata: %s\n\n", payload)
			flusher.Flush()
		}

		srv, err := s.servers.InstallCurseForgeServer(r.Context(), deployInput, progressFn)
		if err != nil {
			errPayload, _ := json.Marshal(map[string]string{
				"error": err.Error(),
			})
			fmt.Fprintf(w, "event: error\ndata: %s\n\n", errPayload)
			flusher.Flush()
			return
		}

		donePayload, _ := json.Marshal(map[string]any{
			"status": "completed",
			"server": srv,
		})
		fmt.Fprintf(w, "event: completed\ndata: %s\n\n", donePayload)
		flusher.Flush()
		return
	}

	// Non-streaming standard REST response
	srv, err := s.servers.InstallCurseForgeServer(r.Context(), deployInput, nil)
	if err != nil {
		if errors.Is(err, curseforge.ErrNotConfigured) {
			writeError(w, http.StatusServiceUnavailable, "curseforge_not_configured", "configure a shared CurseForge API key in App Settings")
			return
		}
		if errors.Is(err, ports.ErrPortPoolFull) || errors.Is(err, servers.ErrPortInUse) {
			writeError(w, http.StatusConflict, "port_in_use", err.Error())
			return
		}
		if errors.Is(err, curseforge.ErrResourceNotFound) {
			writeError(w, http.StatusNotFound, "not_found", err.Error())
			return
		}
		writeError(w, http.StatusBadRequest, "deploy_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"server": srv,
		"id":     srv.ID,
		"name":   srv.Name,
		"status": "deployed",
	})
}
