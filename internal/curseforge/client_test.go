package curseforge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCurseForgeClient_SearchModpacks(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "test-api-key" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if r.URL.Path != "/mods/search" {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		q := r.URL.Query()
		if q.Get("gameId") != "432" || q.Get("classId") != "4471" {
			t.Errorf("expected gameId=432 and classId=4471, got %s and %s", q.Get("gameId"), q.Get("classId"))
		}
		if q.Get("searchFilter") != "All the Mods" {
			t.Errorf("expected searchFilter='All the Mods', got %s", q.Get("searchFilter"))
		}
		if q.Get("gameVersion") != "1.20.1" {
			t.Errorf("expected gameVersion=1.20.1, got %s", q.Get("gameVersion"))
		}
		if q.Get("modLoaderType") != "1" {
			t.Errorf("expected modLoaderType=1, got %s", q.Get("modLoaderType"))
		}

		resp := SearchResponse{
			Data: []Modpack{
				{
					ID:            12345,
					Name:          "All the Mods 9",
					Slug:          "all-the-mods-9",
					Summary:       "ATM9 modpack",
					DownloadCount: 500000,
					Authors:       []ModpackAuthor{{Name: "ATMTeam"}},
					LatestFiles: []ModpackFile{
						{
							ID:               67890,
							DisplayName:      "ATM9 0.2.60",
							FileName:         "ATM9-0.2.60.zip",
							ReleaseType:      1,
							GameVersions:     []string{"1.20.1", "Forge"},
							ServerPackFileID: 67891,
						},
					},
				},
			},
			Pagination: Pagination{
				Index:      0,
				PageSize:   20,
				TotalCount: 1,
			},
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer ts.Close()

	client := NewClient("test-api-key")
	client.BaseURL = ts.URL

	ctx := context.Background()
	res, err := client.SearchModpacks(ctx, ModpackFilter{
		SearchFilter:  "All the Mods",
		GameVersion:   "1.20.1",
		ModLoaderType: LoaderForge,
	})
	if err != nil {
		t.Fatalf("SearchModpacks failed: %v", err)
	}

	if len(res.Data) != 1 {
		t.Fatalf("expected 1 modpack, got %d", len(res.Data))
	}
	mp := res.Data[0]
	if mp.Name != "All the Mods 9" {
		t.Errorf("expected name 'All the Mods 9', got %s", mp.Name)
	}
	if len(mp.LatestFiles) != 1 {
		t.Fatalf("expected 1 latest file, got %d", len(mp.LatestFiles))
	}
	if !mp.LatestFiles[0].HasServerPack {
		t.Errorf("expected HasServerPack to be true for ServerPackFileID > 0")
	}
	if mp.LatestVersionTag != "1.20.1" {
		t.Errorf("expected LatestVersionTag '1.20.1', got %s", mp.LatestVersionTag)
	}
}

func TestCurseForgeClient_GetModpackFiles(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/mods/12345/files" {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		resp := FilesResponse{
			Data: []ModpackFile{
				{
					ID:               1001,
					DisplayName:      "Version 1.0 (Server Pack)",
					FileName:         "client.zip",
					ReleaseType:      1,
					GameVersions:     []string{"1.20.1", "Forge"},
					ServerPackFileID: 2001,
				},
				{
					ID:               1002,
					DisplayName:      "Version 0.9 (Client Only)",
					FileName:         "client-old.zip",
					ReleaseType:      2,
					GameVersions:     []string{"1.20.1", "Forge"},
					ServerPackFileID: 0,
				},
			},
			Pagination: Pagination{
				Index:      0,
				PageSize:   20,
				TotalCount: 2,
			},
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer ts.Close()

	client := NewClient("test-key")
	client.BaseURL = ts.URL

	ctx := context.Background()
	res, err := client.GetModpackFiles(ctx, 12345, "1.20.1", LoaderForge, 20, 0)
	if err != nil {
		t.Fatalf("GetModpackFiles failed: %v", err)
	}

	if len(res.Data) != 2 {
		t.Fatalf("expected 2 files, got %d", len(res.Data))
	}
	if !res.Data[0].HasServerPack || res.Data[0].ServerPackFileID != 2001 {
		t.Errorf("expected first file to highlight serverPackFileId 2001 with HasServerPack=true")
	}
	if res.Data[1].HasServerPack || res.Data[1].ServerPackFileID != 0 {
		t.Errorf("expected second file to have HasServerPack=false")
	}
}

func TestCurseForgeClient_GetFileDownloadURL(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/mods/12345/files/2001/download-url" {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"data": "https://edge.forgecdn.net/files/2001/server.zip",
		})
	}))
	defer ts.Close()

	client := NewClient("test-key")
	client.BaseURL = ts.URL

	url, err := client.GetFileDownloadURL(context.Background(), 12345, 2001)
	if err != nil {
		t.Fatalf("GetFileDownloadURL failed: %v", err)
	}
	if url != "https://edge.forgecdn.net/files/2001/server.zip" {
		t.Errorf("unexpected URL: %s", url)
	}
}
