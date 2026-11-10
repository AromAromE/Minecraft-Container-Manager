package api

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mcm-panel/mcm/internal/auth"
	"github.com/mcm-panel/mcm/internal/curseforge"
	"github.com/mcm-panel/mcm/internal/db"
	"github.com/mcm-panel/mcm/internal/jars"
	"github.com/mcm-panel/mcm/internal/servers"
)

func createMockZip() []byte {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("run.sh")
	_, _ = w.Write([]byte("#!/bin/sh\njava -jar server.jar\n"))
	w2, _ := zw.Create("server.jar")
	_, _ = w2.Write([]byte("mock jar"))
	_ = zw.Close()
	return buf.Bytes()
}

func TestCurseForgeModpackEndpoints(t *testing.T) {
	tempDir := t.TempDir()
	store, err := db.Open(filepath.Join(tempDir, "mcm_cf_api_test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { store.Close() })

	ctx := context.Background()
	users := auth.NewUsers(store.DB)
	admin, err := users.Create(ctx, "cf-modpacks-admin@example.com", "password")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	sessions := auth.NewManager(store.DB)
	token, err := sessions.Create(ctx, admin.ID)
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	jr := jars.NewResolver()
	serverStore := servers.NewStore(store, nil, jr, 25565, 25575, tempDir, "")

	apiServer := New(Options{
		DB:       store,
		Users:    users,
		Sessions: sessions,
		Servers:  serverStore,
	})

	// 1. When CurseForge is not configured, endpoints should return 503
	t.Setenv("CURSEFORGE_API_KEY", "")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/curseforge/modpacks", nil)
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: token})
	rr := httptest.NewRecorder()
	apiServer.ServeHTTP(rr, req)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when unconfigured, got %d", rr.Code)
	}

	// 2. Configure mock upstream CurseForge server
	zipData := createMockZip()
	var mockCF *httptest.Server
	mockCF = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/mods/search":
			_ = json.NewEncoder(w).Encode(curseforge.SearchResponse{
				Data: []curseforge.Modpack{
					{
						ID:            55555,
						Name:          "Medieval MC",
						Slug:          "medieval-mc",
						Summary:       "Medieval RPG Modpack",
						DownloadCount: 1200000,
						LatestFiles: []curseforge.ModpackFile{
							{
								ID:               99901,
								DisplayName:      "Medieval MC v1.0",
								FileName:         "Medieval-1.0.zip",
								ReleaseType:      1,
								GameVersions:     []string{"1.20.1", "Fabric"},
								ServerPackFileID: 99902,
							},
						},
					},
				},
				Pagination: curseforge.Pagination{Index: 0, PageSize: 20, TotalCount: 1},
			})

		case r.URL.Path == "/mods/55555/files":
			_ = json.NewEncoder(w).Encode(curseforge.FilesResponse{
				Data: []curseforge.ModpackFile{
					{
						ID:               99901,
						DisplayName:      "Medieval MC v1.0",
						FileName:         "Medieval-1.0.zip",
						ReleaseType:      1,
						GameVersions:     []string{"1.20.1", "Fabric"},
						ServerPackFileID: 99902,
					},
				},
				Pagination: curseforge.Pagination{Index: 0, PageSize: 20, TotalCount: 1},
			})

		case r.URL.Path == "/mods/55555/files/99901":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": curseforge.ModpackFile{
					ID:               99901,
					ModID:            55555,
					DisplayName:      "Medieval MC v1.0",
					FileName:         "Medieval-1.0.zip",
					ReleaseType:      1,
					GameVersions:     []string{"1.20.1", "Fabric"},
					ServerPackFileID: 99902,
				},
			})

		case r.URL.Path == "/mods/55555/files/99902":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": curseforge.ModpackFile{
					ID:           99902,
					ModID:        55555,
					DisplayName:  "Medieval MC Server Pack v1.0",
					FileName:     "Server-Medieval-1.0.zip",
					ReleaseType:  1,
					DownloadURL:  mockCF.URL + "/download/medieval-server.zip",
					GameVersions: []string{"1.20.1", "Fabric"},
				},
			})

		case r.URL.Path == "/download/medieval-server.zip":
			w.Header().Set("Content-Type", "application/zip")
			_, _ = w.Write(zipData)

		case r.URL.Path == "/categories":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []curseforge.Category{
					{ID: 10, Name: "Adventure and RPG", Slug: "adventure-rpg"},
				},
			})

		default:
			http.NotFound(w, r)
		}
	}))
	defer mockCF.Close()

	t.Setenv("CURSEFORGE_API_KEY", "test-key-valid")
	t.Setenv("CURSEFORGE_API_BASE_URL", mockCF.URL)

	// Test GET /api/v1/curseforge/modpacks
	req = httptest.NewRequest(http.MethodGet, "/api/v1/curseforge/modpacks?searchFilter=Medieval", nil)
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: token})
	rr = httptest.NewRecorder()
	apiServer.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("search modpacks failed: %d %s", rr.Code, rr.Body.String())
	}

	var searchRes curseforge.SearchResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &searchRes); err != nil {
		t.Fatalf("unmarshal search: %v", err)
	}
	if len(searchRes.Data) != 1 || searchRes.Data[0].Name != "Medieval MC" {
		t.Fatalf("unexpected search results: %+v", searchRes.Data)
	}

	// Test GET /api/v1/curseforge/modpacks/{modId}/files
	req = httptest.NewRequest(http.MethodGet, "/api/v1/curseforge/modpacks/55555/files", nil)
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: token})
	rr = httptest.NewRecorder()
	apiServer.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("get files failed: %d %s", rr.Code, rr.Body.String())
	}

	var filesRes curseforge.FilesResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &filesRes); err != nil {
		t.Fatalf("unmarshal files: %v", err)
	}
	if len(filesRes.Data) != 1 {
		t.Fatalf("expected 1 file, got %d", len(filesRes.Data))
	}
	if !filesRes.Data[0].HasServerPack || filesRes.Data[0].ServerPackFileID != 99902 {
		t.Errorf("expected file to highlight serverPackFileId 99902 with HasServerPack=true")
	}

	// Test POST /api/v1/curseforge/install-server
	deployPayload := `{"modId": 55555, "fileId": 99901, "serverName": "My Medieval Server", "memoryLimit": "8GB", "port": 25565}`
	req = httptest.NewRequest(http.MethodPost, "/api/v1/curseforge/install-server", strings.NewReader(deployPayload))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: token})
	rr = httptest.NewRecorder()
	apiServer.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("install-server failed: %d %s", rr.Code, rr.Body.String())
	}

	var deployedResp map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &deployedResp); err != nil {
		t.Fatalf("unmarshal deploy response: %v", err)
	}
	if deployedResp["status"] != "deployed" {
		t.Errorf("expected status 'deployed', got %v", deployedResp["status"])
	}

	serverObj, ok := deployedResp["server"].(map[string]any)
	if !ok || serverObj["name"] != "My Medieval Server" {
		t.Errorf("expected server name 'My Medieval Server', got %v", serverObj)
	}
	if serverObj["server_type"] != "fabric" {
		t.Errorf("expected server_type 'fabric', got %v", serverObj["server_type"])
	}
}
