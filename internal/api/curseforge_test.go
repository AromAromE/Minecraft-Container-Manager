package api

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mcm-panel/mcm/internal/auth"
	"github.com/mcm-panel/mcm/internal/curseforge"
	"github.com/mcm-panel/mcm/internal/proxy"
)

func TestCurseForgeSettingsAPI(t *testing.T) {
	t.Setenv("CURSEFORGE_API_KEY", "")
	store, handler := newUsersTestServer(t)
	ctx := context.Background()
	users := auth.NewUsers(store.DB)
	admin, err := users.Create(ctx, "cf-admin@example.test", "hash")
	if err != nil {
		t.Fatal(err)
	}
	viewer, err := users.CreateWithAccess(ctx, "cf-viewer@example.test", "hash", auth.Access{Role: "viewer", AllServers: true})
	if err != nil {
		t.Fatal(err)
	}
	adminToken := mustSession(t, store, admin.ID)
	viewerToken := mustSession(t, store, viewer.ID)
	request := func(token, method, path, body string) *httptest.ResponseRecorder {
		return permissionRequest(t, handler, token, method, path, body)
	}
	for _, route := range []string{"GET /api/curseforge/settings", "PUT /api/curseforge/settings", "GET /api/curseforge/mods/search", "POST /api/curseforge/mods"} {
		method, path, _ := strings.Cut(route, " ")
		if rr := request("", method, path, `{}`); rr.Code != http.StatusUnauthorized {
			t.Fatalf("unauthenticated %s: %d %s", route, rr.Code, rr.Body.String())
		}
	}
	if rr := request(viewerToken, "PUT", "/api/curseforge/settings", `{"api_key":"viewer-key"}`); rr.Code != http.StatusForbidden {
		t.Fatalf("viewer could change shared key: %d", rr.Code)
	}
	// Mutations also require CSRF, even for administrators.
	req := httptest.NewRequest("PUT", "/api/curseforge/settings", strings.NewReader(`{"api_key":"secret"}`))
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: adminToken})
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("accepted save without CSRF: %d", rr.Code)
	}
	if rr := request(viewerToken, "GET", "/api/curseforge/mods/search", ""); rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured catalog: %d %s", rr.Code, rr.Body.String())
	}
	rr = request(adminToken, "PUT", "/api/curseforge/settings", `{"api_key":"  private-shared-key  "}`)
	if rr.Code != http.StatusOK || strings.Contains(rr.Body.String(), "private-shared-key") || !strings.Contains(rr.Body.String(), `"configured":true`) {
		t.Fatalf("save: %d %s", rr.Code, rr.Body.String())
	}
	for _, token := range []string{adminToken, viewerToken} {
		rr = request(token, "GET", "/api/curseforge/settings", "")
		if rr.Code != http.StatusOK || strings.Contains(rr.Body.String(), "private-shared-key") || !strings.Contains(rr.Body.String(), `"configured":true`) {
			t.Fatalf("shared status: %d %s", rr.Code, rr.Body.String())
		}
	}
	rr = request(adminToken, "GET", "/api/settings", "")
	if rr.Code != http.StatusOK || strings.Contains(rr.Body.String(), curseforge.SettingsKey) || strings.Contains(rr.Body.String(), "private-shared-key") {
		t.Fatalf("generic settings leak: %s", rr.Body.String())
	}
	rr = request(adminToken, "PUT", "/api/settings", `{"settings":{"curseforge_api_key":"bypass"}}`)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("generic settings bypass: %d", rr.Code)
	}
	for _, body := range []string{`{}`, `{"api_key":null}`, `{"api_key":"key\r\ninjected"}`, `{broken`} {
		if rr := request(adminToken, "PUT", "/api/curseforge/settings", body); rr.Code != http.StatusBadRequest {
			t.Fatalf("invalid save accepted: %d %s", rr.Code, rr.Body.String())
		}
	}
	rr = request(adminToken, "PUT", "/api/curseforge/settings", `{"api_key":""}`)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"configured":false`) {
		t.Fatalf("clear: %d %s", rr.Code, rr.Body.String())
	}
}

func TestCurseForgeCatalogSharedCredentialAndCache(t *testing.T) {
	t.Setenv("CURSEFORGE_API_KEY", "environment-key")
	store, _ := newUsersTestServer(t)
	if _, err := curseforge.Save(context.Background(), store.DB, "shared-key"); err != nil {
		t.Fatal(err)
	}
	px := proxy.NewService()
	calls := 0
	expectedKey := "shared-key"
	px.SetClient(&http.Client{Transport: roundTripFunc(func(r *http.Request) *http.Response {
		calls++
		if r.URL.Host != "api.curseforge.com" || r.Header.Get("x-api-key") != expectedKey {
			t.Errorf("wrong upstream credential or host: %s %v", r.URL, r.Header)
		}
		if r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
			t.Error("forwarded browser credentials")
		}
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"data":[]}`))}
	})})
	users := auth.NewUsers(store.DB)
	admin, err := users.Create(context.Background(), "catalog-admin@example.test", "hash")
	if err != nil {
		t.Fatal(err)
	}
	viewer, err := users.CreateWithAccess(context.Background(), "catalog-viewer@example.test", "hash", auth.Access{Role: "viewer", AllServers: true})
	if err != nil {
		t.Fatal(err)
	}
	tokens := []string{mustSession(t, store, admin.ID), mustSession(t, store, viewer.ID)}
	s := &Server{db: store, proxy: px, users: users, sessions: auth.NewManager(store.DB), mux: http.NewServeMux()}
	s.routes()
	for i, browserKey := range []string{"user-one-key", "user-two-key"} {
		req := httptest.NewRequest("GET", "/api/curseforge/mods/search?gameId=432&searchFilter=jei", nil)
		req.Header.Set("x-api-key", browserKey)
		req.Header.Set("x-curseforge-api-key", browserKey)
		req.Header.Set("Cookie", "session=browser-secret")
		req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: tokens[i]})
		req.Header.Set("Authorization", "Bearer browser-secret")
		rr := httptest.NewRecorder()
		s.mux.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK || strings.Contains(rr.Body.String(), "shared-key") {
			t.Fatalf("catalog: %d %s", rr.Code, rr.Body.String())
		}
		if i == 1 && rr.Header().Get("X-MCM-Cache") != "HIT" {
			t.Fatal("catalog cache was not shared across users")
		}
	}
	if calls != 1 {
		t.Fatalf("expected one shared request, got %d", calls)
	}
	for _, key := range []string{"rotated-shared-key", ""} {
		body := `{"api_key":"` + key + `"}`
		rr := permissionRequest(t, s.mux, tokens[0], "PUT", "/api/curseforge/settings", body)
		if rr.Code != http.StatusOK || strings.Contains(rr.Body.String(), "rotated-shared-key") {
			t.Fatalf("rotate or clear: %d %s", rr.Code, rr.Body.String())
		}
		expectedKey = key
		if key == "" {
			expectedKey = "environment-key"
		}
		before := calls
		rr = permissionRequest(t, s.mux, tokens[1], "GET", "/api/curseforge/mods/search?gameId=432&searchFilter=jei", "")
		if rr.Code != http.StatusOK || calls != before+1 {
			t.Fatalf("new credential reused stale cache: %d %s", rr.Code, rr.Body.String())
		}
	}
	for _, path := range []string{"mods/123/description", "api-keys", "../secret", "https://evil.test", "mods/1/files/2/download-url/extra"} {
		req := httptest.NewRequest("GET", "/api/curseforge/invalid", nil)
		req.SetPathValue("path", path)
		rr := httptest.NewRecorder()
		s.handleCurseForge(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("accepted unsupported endpoint %q: %d", path, rr.Code)
		}
	}
	req := httptest.NewRequest("GET", "/api/proxy?url=https://api.curseforge.com/v1/mods/search", nil)
	rr := httptest.NewRecorder()
	s.handleProxy(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("legacy proxy bypass accepted: %d", rr.Code)
	}
}
