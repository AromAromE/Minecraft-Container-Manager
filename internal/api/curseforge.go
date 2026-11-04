package api

import (
	"net/http"
	"regexp"

	"github.com/mcm-panel/mcm/internal/curseforge"
)

func (s *Server) handleGetCurseForgeSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := curseforge.Status(r.Context(), s.db.DB)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not read CurseForge settings")
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handlePutCurseForgeSettings(w http.ResponseWriter, r *http.Request) {
	var input struct {
		APIKey *string `json:"api_key"`
	}
	if err := decodeJSON(w, r, &input); err != nil || input.APIKey == nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "api_key is required; use an empty string to clear the saved key")
		return
	}
	if err := curseforge.ValidateKey(*input.APIKey); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	settings, err := curseforge.Save(r.Context(), s.db.DB, *input.APIKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not save CurseForge settings")
		return
	}
	s.proxy.ClearCache()
	writeJSON(w, http.StatusOK, settings)
}

// Only the read-only catalog endpoints used by the panel may use the shared key.
var curseForgeCatalogPath = regexp.MustCompile(`^mods/(search|[1-9][0-9]*/files(/[1-9][0-9]*(/download-url)?)?)$`)

func (s *Server) handleCurseForge(w http.ResponseWriter, r *http.Request) {
	path := r.PathValue("path")
	if (r.Method == http.MethodGet && !curseForgeCatalogPath.MatchString(path)) ||
		(r.Method == http.MethodPost && path != "mods") {
		writeError(w, http.StatusBadRequest, "invalid_request", "unsupported CurseForge catalog endpoint")
		return
	}
	key, err := curseforge.APIKey(r.Context(), s.db.DB)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not read CurseForge settings")
		return
	}
	if key == "" {
		writeError(w, http.StatusServiceUnavailable, "curseforge_not_configured", "configure a shared CurseForge API key in App Settings")
		return
	}
	headers := make(http.Header)
	headers.Set("x-api-key", key)
	target := "https://api.curseforge.com/v1/" + path
	if r.URL.RawQuery != "" {
		target += "?" + r.URL.RawQuery
	}
	s.proxyCatalog(w, r, target, headers)
}
