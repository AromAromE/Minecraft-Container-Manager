package api

import (
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/mcm-panel/mcm/internal/proxy"
)

// handleProxy proxies requests to whitelisted external catalog APIs with caching,
// deduplication, and rate limiting.
func (s *Server) handleProxy(w http.ResponseWriter, r *http.Request) {
	targetURL := strings.TrimSpace(r.URL.Query().Get("url"))
	if targetURL == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "Missing 'url' query parameter")
		return
	}
	if target, err := url.Parse(targetURL); err == nil && strings.EqualFold(target.Hostname(), "api.curseforge.com") {
		writeError(w, http.StatusBadRequest, "invalid_request", "use the server-side CurseForge catalog endpoint")
		return
	}
	// Browser-supplied credentials must never be forwarded to catalog providers.
	s.proxyCatalog(w, r, targetURL, nil)
}

func (s *Server) proxyCatalog(w http.ResponseWriter, r *http.Request, targetURL string, headers http.Header) {
	skipCache := r.URL.Query().Get("skip_cache") == "true" || r.Header.Get("Cache-Control") == "no-cache"

	var body []byte
	if r.Method == http.MethodPost || r.Method == http.MethodPut {
		var err error
		body, err = io.ReadAll(io.LimitReader(r.Body, 2<<20)) // 2MB limit
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request", "Could not read request body")
			return
		}
	}

	resp, err := s.proxy.Do(r.Context(), r.Method, targetURL, body, headers, skipCache)
	if err != nil {
		if errors.Is(err, proxy.ErrForbiddenHost) {
			writeError(w, http.StatusForbidden, "forbidden_host", err.Error())
			return
		}
		if errors.Is(err, proxy.ErrInvalidScheme) {
			writeError(w, http.StatusBadRequest, "invalid_scheme", err.Error())
			return
		}
		if errors.Is(err, proxy.ErrRateLimited) {
			w.Header().Set("Retry-After", "10")
			writeError(w, http.StatusTooManyRequests, "rate_limited", err.Error())
			return
		}
		writeError(w, http.StatusBadGateway, "upstream_error", err.Error())
		return
	}

	if resp.ContentType != "" {
		w.Header().Set("Content-Type", resp.ContentType)
	} else {
		w.Header().Set("Content-Type", "application/json")
	}
	w.Header().Set("X-MCM-Cache", resp.CacheStatus)
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(resp.Body)
}
