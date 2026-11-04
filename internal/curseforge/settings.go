// Package curseforge stores the shared, server-side CurseForge credential.
package curseforge

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
)

const SettingsKey = "curseforge_api_key"

// Settings exposes availability, never the credential itself.
type Settings struct {
	Configured bool   `json:"configured"`
	Source     string `json:"source"` // database, environment, or empty
}

func load(ctx context.Context, db *sql.DB) (string, string, error) {
	if db != nil {
		var key string
		err := db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key=?`, SettingsKey).Scan(&key)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return "", "", err
		}
		if key = strings.TrimSpace(key); key != "" {
			return key, "database", nil
		}
	}
	if key := strings.TrimSpace(os.Getenv("CURSEFORGE_API_KEY")); key != "" {
		return key, "environment", nil
	}
	return "", "", nil
}

func APIKey(ctx context.Context, db *sql.DB) (string, error) {
	key, _, err := load(ctx, db)
	return key, err
}

func Status(ctx context.Context, db *sql.DB) (Settings, error) {
	key, source, err := load(ctx, db)
	return Settings{Configured: key != "", Source: source}, err
}

func ValidateKey(key string) error {
	key = strings.TrimSpace(key)
	if len(key) > 4096 {
		return errors.New("CurseForge API key is too long")
	}
	for _, char := range key {
		if char < 33 || char > 126 {
			return errors.New("CurseForge API key must contain only printable, non-space ASCII characters")
		}
	}
	return nil
}

// Save replaces the installation-wide credential. Clearing it restores the environment fallback.
func Save(ctx context.Context, db *sql.DB, key string) (Settings, error) {
	if err := ValidateKey(key); err != nil {
		return Settings{}, err
	}
	key = strings.TrimSpace(key)
	var err error
	if key == "" {
		_, err = db.ExecContext(ctx, `DELETE FROM settings WHERE key=?`, SettingsKey)
	} else {
		_, err = db.ExecContext(ctx, `INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, SettingsKey, key)
	}
	if err != nil {
		return Settings{}, err
	}
	return Status(ctx, db)
}
