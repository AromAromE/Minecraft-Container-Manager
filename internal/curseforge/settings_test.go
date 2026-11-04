package curseforge

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mcm-panel/mcm/internal/db"
)

func TestSharedSettingsAndEnvironmentFallback(t *testing.T) {
	t.Setenv("CURSEFORGE_API_KEY", "environment-secret")
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "mcm.db")
	store, err := db.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	settings, err := Status(ctx, store.DB)
	if err != nil || !settings.Configured || settings.Source != "environment" {
		t.Fatalf("environment status: %+v %v", settings, err)
	}
	settings, err = Save(ctx, store.DB, "  $2a$10$database-secret  ")
	if err != nil || !settings.Configured || settings.Source != "database" {
		t.Fatalf("save: %+v %v", settings, err)
	}
	public, _ := json.Marshal(settings)
	if strings.Contains(string(public), "secret") {
		t.Fatalf("settings leaked credential: %s", public)
	}
	// A new database connection (as after a restart) reads the same shared key.
	reopened, err := db.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if key, err := APIKey(ctx, reopened.DB); err != nil || key != "$2a$10$database-secret" {
		t.Fatalf("persisted key: %q %v", key, err)
	}
	settings, err = Save(ctx, reopened.DB, "")
	if err != nil || settings.Source != "environment" {
		t.Fatalf("clear fallback: %+v %v", settings, err)
	}
	t.Setenv("CURSEFORGE_API_KEY", "")
	settings, err = Status(ctx, store.DB)
	if err != nil || settings.Configured || settings.Source != "" {
		t.Fatalf("unconfigured status: %+v %v", settings, err)
	}
}

func TestKeyValidation(t *testing.T) {
	for _, key := range []string{"key\r\ninjected", "key value", "key\x00", "non-ascii-🔑", strings.Repeat("x", 4097)} {
		if err := ValidateKey(key); err == nil {
			t.Errorf("accepted invalid key %q", key)
		}
	}
	for _, key := range []string{"", "  key  ", "$2a$10$valid-key"} {
		if err := ValidateKey(key); err != nil {
			t.Errorf("rejected valid key %q: %v", key, err)
		}
	}
}
