package curseforge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultBaseURL  = "https://api.curseforge.com/v1"
	MinecraftGameID = 432
	ModpackClassID  = 4471

	LoaderAny      = 0
	LoaderForge    = 1
	LoaderCauldron = 2
	LoaderLite     = 3
	LoaderFabric   = 4
	LoaderQuilt    = 5
	LoaderNeoForge = 6

	SortFeatured       = 1
	SortPopularity     = 2
	SortLastUpdated    = 3
	SortName           = 4
	SortAuthor         = 5
	SortTotalDownloads = 6
)

var (
	ErrNotConfigured   = errors.New("CurseForge API key is not configured")
	ErrResourceNotFound = errors.New("CurseForge resource not found")
	ErrUpstreamError   = errors.New("CurseForge upstream error")
	ErrNoDownloadURL   = errors.New("no download URL available for this file")
)

// Client interacts with the CurseForge Eternal API.
type Client struct {
	BaseURL    string
	HTTPClient *http.Client
	APIKey     string
}

// NewClient creates a new CurseForge API client.
func NewClient(apiKey string) *Client {
	baseURL := DefaultBaseURL
	if env := strings.TrimSpace(os.Getenv("CURSEFORGE_API_BASE_URL")); env != "" {
		baseURL = env
	}
	cleanKey := strings.Trim(strings.TrimSpace(apiKey), "\"'")
	return &Client{
		BaseURL: baseURL,
		HTTPClient: &http.Client{
			Timeout: 45 * time.Second,
		},
		APIKey: cleanKey,
	}
}

// ModpackFilter parameters for searching modpacks.
type ModpackFilter struct {
	SearchFilter  string
	GameVersion   string
	ModLoaderType int
	SortField     int
	SortOrder     string
	PageSize      int
	Index         int
	CategoryID    int
}

// ModpackFile represents a release or server file in CurseForge.
type ModpackFile struct {
	ID               int          `json:"id"`
	GameID           int          `json:"gameId"`
	ModID            int          `json:"modId"`
	IsAvailable      bool         `json:"isAvailable"`
	DisplayName      string       `json:"displayName"`
	FileName         string       `json:"fileName"`
	ReleaseType      int          `json:"releaseType"`
	FileStatus       int          `json:"fileStatus"`
	FileDate         string       `json:"fileDate"`
	FileLength       int64        `json:"fileLength"`
	DownloadCount    int64        `json:"downloadCount"`
	DownloadURL      string       `json:"downloadUrl"`
	GameVersions     []string     `json:"gameVersions"`
	ServerPackFileID int          `json:"serverPackFileId"`
	HasServerPack    bool         `json:"hasServerPack"`
}

// ModpackAuthor represents an author of a modpack.
type ModpackAuthor struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	URL  string `json:"url"`
}

// ModpackLogo represents the icon or logo of a modpack.
type ModpackLogo struct {
	ID           int    `json:"id"`
	ThumbnailURL string `json:"thumbnailUrl"`
	URL          string `json:"url"`
}

// Category represents a CurseForge category.
type Category struct {
	ID      int    `json:"id"`
	GameID  int    `json:"gameId"`
	Name    string `json:"name"`
	Slug    string `json:"slug"`
	URL     string `json:"url"`
	IconURL string `json:"iconUrl"`
}

// Modpack represents a Minecraft modpack listed on CurseForge.
type Modpack struct {
	ID               int             `json:"id"`
	GameID           int             `json:"gameId"`
	Name             string          `json:"name"`
	Slug             string          `json:"slug"`
	Summary          string          `json:"summary"`
	DownloadCount    int64           `json:"downloadCount"`
	Authors          []ModpackAuthor `json:"authors"`
	Logo             *ModpackLogo    `json:"logo"`
	Categories       []Category      `json:"categories"`
	DateModified     string          `json:"dateModified"`
	DateCreated      string          `json:"dateCreated"`
	DateReleased     string          `json:"dateReleased"`
	LatestFiles      []ModpackFile   `json:"latestFiles"`
	LatestVersionTag string          `json:"latestVersionTag,omitempty"`
}

// Pagination metadata returned by CurseForge.
type Pagination struct {
	Index      int `json:"index"`
	PageSize   int `json:"pageSize"`
	TotalCount int `json:"totalCount"`
}

// SearchResponse is the API payload returned when searching modpacks.
type SearchResponse struct {
	Data       []Modpack  `json:"data"`
	Pagination Pagination `json:"pagination"`
}

// FilesResponse is the API payload returned when listing files for a modpack.
type FilesResponse struct {
	Data       []ModpackFile `json:"data"`
	Pagination Pagination    `json:"pagination"`
}

type singleFileResponse struct {
	Data ModpackFile `json:"data"`
}

type downloadURLResponse struct {
	Data string `json:"data"`
}

type categoriesResponse struct {
	Data []Category `json:"data"`
}

func (c *Client) request(ctx context.Context, method, endpoint string, query url.Values) ([]byte, error) {
	if c.APIKey == "" {
		return nil, ErrNotConfigured
	}

	u := strings.TrimRight(c.BaseURL, "/") + "/" + strings.TrimLeft(endpoint, "/")
	if len(query) > 0 {
		u += "?" + query.Encode()
	}

	req, err := http.NewRequestWithContext(ctx, method, u, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("x-api-key", c.APIKey)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "mcm-panel/1.0 (https://github.com/mcm-panel/mcm)")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUpstreamError, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20)) // 16MB max limit
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrResourceNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: HTTP %d: %s", ErrUpstreamError, resp.StatusCode, string(body))
	}

	return body, nil
}

// SearchModpacks searches CurseForge for modpacks matching the given filter.
func (c *Client) SearchModpacks(ctx context.Context, filter ModpackFilter) (*SearchResponse, error) {
	query := make(url.Values)
	query.Set("gameId", strconv.Itoa(MinecraftGameID))
	query.Set("classId", strconv.Itoa(ModpackClassID))

	if s := strings.TrimSpace(filter.SearchFilter); s != "" {
		query.Set("searchFilter", s)
	}
	if v := strings.TrimSpace(filter.GameVersion); v != "" {
		query.Set("gameVersion", v)
	}
	if filter.ModLoaderType > 0 {
		query.Set("modLoaderType", strconv.Itoa(filter.ModLoaderType))
	}
	if filter.CategoryID > 0 {
		query.Set("categoryId", strconv.Itoa(filter.CategoryID))
	}

	sortField := filter.SortField
	if sortField <= 0 {
		sortField = SortPopularity
	}
	query.Set("sortField", strconv.Itoa(sortField))

	sortOrder := strings.ToLower(strings.TrimSpace(filter.SortOrder))
	if sortOrder != "asc" && sortOrder != "desc" {
		if sortField == SortName {
			sortOrder = "asc"
		} else {
			sortOrder = "desc"
		}
	}
	query.Set("sortOrder", sortOrder)

	pageSize := filter.PageSize
	if pageSize <= 0 {
		pageSize = 20
	} else if pageSize > 50 {
		pageSize = 50
	}
	query.Set("pageSize", strconv.Itoa(pageSize))

	index := filter.Index
	if index < 0 {
		index = 0
	}
	query.Set("index", strconv.Itoa(index))

	body, err := c.request(ctx, http.MethodGet, "mods/search", query)
	if err != nil {
		return nil, err
	}

	var res SearchResponse
	if err := json.Unmarshal(body, &res); err != nil {
		return nil, fmt.Errorf("decode modpack search response: %w", err)
	}

	// Post-process files and extract latest version tag
	for i := range res.Data {
		for j := range res.Data[i].LatestFiles {
			if res.Data[i].LatestFiles[j].ServerPackFileID > 0 {
				res.Data[i].LatestFiles[j].HasServerPack = true
			}
		}
		res.Data[i].LatestVersionTag = extractLatestVersionTag(res.Data[i].LatestFiles)
	}

	return &res, nil
}

// GetModpackFiles retrieves files for a modpack, specifically highlighting if a serverPackFileId exists.
func (c *Client) GetModpackFiles(ctx context.Context, modID int, gameVersion string, modLoaderType, pageSize, index int) (*FilesResponse, error) {
	if modID <= 0 {
		return nil, errors.New("invalid mod ID")
	}

	query := make(url.Values)
	if v := strings.TrimSpace(gameVersion); v != "" {
		query.Set("gameVersion", v)
	}
	if modLoaderType > 0 {
		query.Set("modLoaderType", strconv.Itoa(modLoaderType))
	}
	if pageSize <= 0 {
		pageSize = 20
	} else if pageSize > 50 {
		pageSize = 50
	}
	query.Set("pageSize", strconv.Itoa(pageSize))
	if index > 0 {
		query.Set("index", strconv.Itoa(index))
	}

	endpoint := fmt.Sprintf("mods/%d/files", modID)
	body, err := c.request(ctx, http.MethodGet, endpoint, query)
	if err != nil {
		return nil, err
	}

	var res FilesResponse
	if err := json.Unmarshal(body, &res); err != nil {
		return nil, fmt.Errorf("decode modpack files response: %w", err)
	}

	for i := range res.Data {
		if res.Data[i].ServerPackFileID > 0 {
			res.Data[i].HasServerPack = true
		}
	}

	return &res, nil
}

// GetFile retrieves details for a single file of a mod/modpack.
func (c *Client) GetFile(ctx context.Context, modID, fileID int) (*ModpackFile, error) {
	if modID <= 0 || fileID <= 0 {
		return nil, errors.New("invalid mod ID or file ID")
	}

	endpoint := fmt.Sprintf("mods/%d/files/%d", modID, fileID)
	body, err := c.request(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}

	var res singleFileResponse
	if err := json.Unmarshal(body, &res); err != nil {
		return nil, fmt.Errorf("decode modpack file response: %w", err)
	}

	if res.Data.ServerPackFileID > 0 {
		res.Data.HasServerPack = true
	}

	return &res.Data, nil
}

// GetFileDownloadURL queries CurseForge for the file's direct download URL.
func (c *Client) GetFileDownloadURL(ctx context.Context, modID, fileID int) (string, error) {
	if modID <= 0 || fileID <= 0 {
		return "", errors.New("invalid mod ID or file ID")
	}

	endpoint := fmt.Sprintf("mods/%d/files/%d/download-url", modID, fileID)
	body, err := c.request(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}

	var res downloadURLResponse
	if err := json.Unmarshal(body, &res); err != nil {
		return "", fmt.Errorf("decode download url response: %w", err)
	}

	if res.Data == "" {
		return "", ErrNoDownloadURL
	}

	return res.Data, nil
}

// GetCategories returns available modpack categories.
func (c *Client) GetCategories(ctx context.Context) ([]Category, error) {
	query := make(url.Values)
	query.Set("gameId", strconv.Itoa(MinecraftGameID))
	query.Set("classId", strconv.Itoa(ModpackClassID))

	body, err := c.request(ctx, http.MethodGet, "categories", query)
	if err != nil {
		return nil, err
	}

	var res categoriesResponse
	if err := json.Unmarshal(body, &res); err != nil {
		return nil, fmt.Errorf("decode categories response: %w", err)
	}

	return res.Data, nil
}

func extractLatestVersionTag(files []ModpackFile) string {
	for _, f := range files {
		// Prefer primary release
		if f.ReleaseType == 1 {
			for _, v := range f.GameVersions {
				if isMCVersion(v) {
					return v
				}
			}
			if f.DisplayName != "" {
				return f.DisplayName
			}
		}
	}
	if len(files) > 0 {
		for _, v := range files[0].GameVersions {
			if isMCVersion(v) {
				return v
			}
		}
		return files[0].DisplayName
	}
	return ""
}

func isMCVersion(s string) bool {
	s = strings.TrimSpace(s)
	if len(s) < 3 {
		return false
	}
	if strings.HasPrefix(s, "1.") {
		parts := strings.Split(s, ".")
		return len(parts) >= 2
	}
	return false
}
