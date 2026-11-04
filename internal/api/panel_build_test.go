package api

import (
	"log"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/mcm-panel/mcm/internal/buildinfo"
)

func TestPanelBuildHeader(t *testing.T) {
	s := &Server{logger: log.Default()}
	handler := s.withMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/auth/me", nil))
	if got := rr.Header().Get("X-MCM-Build-Commit"); got != buildinfo.Current().Commit {
		t.Fatalf("build header = %q, want %q", got, buildinfo.Current().Commit)
	}
}

func TestFrontendEntryDocumentIsNotCached(t *testing.T) {
	frontend := fstest.MapFS{
		"index.html":           &fstest.MapFile{Data: []byte("<html>MCM</html>")},
		"assets/index-hash.js": &fstest.MapFile{Data: []byte("// bundled interface")},
	}
	for _, path := range []string{"/", "/index.html", "/settings?tab=updates", "/settings?tab=updates&_mcm_build=new&_mcm_reload=1234"} {
		t.Run(path, func(t *testing.T) {
			rr := httptest.NewRecorder()
			serveFrontend(rr, httptest.NewRequest(http.MethodGet, path, nil), frontend)
			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d", rr.Code)
			}
			if got := rr.Header().Get("Cache-Control"); got != "no-store" {
				t.Fatalf("cache control = %q, want no-store", got)
			}
		})
	}
	t.Run("assets are not entry documents", func(t *testing.T) {
		rr := httptest.NewRecorder()
		serveFrontend(rr, httptest.NewRequest(http.MethodGet, "/assets/index-hash.js", nil), frontend)
		if rr.Code != http.StatusOK || rr.Header().Get("Cache-Control") == "no-store" {
			t.Fatalf("asset response: %d, %v", rr.Code, rr.Header())
		}
	})
	t.Run("missing assets are not HTML", func(t *testing.T) {
		rr := httptest.NewRecorder()
		serveFrontend(rr, httptest.NewRequest(http.MethodGet, "/assets/old-build.js", nil), frontend)
		if rr.Code != http.StatusNotFound {
			t.Fatalf("missing asset status = %d", rr.Code)
		}
	})
}
