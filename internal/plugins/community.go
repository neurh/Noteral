package plugins

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// DefaultRegistryURL is the community registry Noteral reads by default. It is
// a plain JSON file in a public GitHub repository — no Noteral server exists.
// Plugin authors add themselves with a pull request (see docs/plugins/publishing.md).
const DefaultRegistryURL = "https://raw.githubusercontent.com/neurh/noteral-plugins/main/registry/community-plugins.json"

const (
	maxRegistryBytes   = 4 << 20
	maxRegistryEntries = 5000
	maxReleaseAsset    = maxEntrySource
)

// RegistryEntry is one line of community-plugins.json.
type RegistryEntry struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Author      string   `json:"author"`
	Description string   `json:"description"`
	Repo        string   `json:"repo"`
	Tags        []string `json:"tags,omitempty"`
}

// CommunityPlugin is a registry entry merged with local install state.
type CommunityPlugin struct {
	RegistryEntry
	Installed        bool   `json:"installed"`
	InstalledVersion string `json:"installedVersion,omitempty"`
	Enabled          bool   `json:"enabled"`
	// InstalledFromRegistry is true when the local copy came from this repo, so
	// updates can be offered for it.
	InstalledFromRegistry bool `json:"installedFromRegistry"`
}

// RegistryResult is what the store UI renders.
type RegistryResult struct {
	URL       string            `json:"url"`
	FetchedAt string            `json:"fetchedAt"`
	Plugins   []CommunityPlugin `json:"plugins"`
	Skipped   int               `json:"skipped"`
}

// Release describes the latest GitHub Release of a community plugin.
type Release struct {
	Repo             string   `json:"repo"`
	Manifest         Manifest `json:"manifest"`
	Tag              string   `json:"tag,omitempty"`
	Notes            string   `json:"notes,omitempty"`
	PublishedAt      string   `json:"publishedAt,omitempty"`
	HTMLURL          string   `json:"htmlUrl"`
	HasStyles        bool     `json:"hasStyles"`
	Compatible       bool     `json:"compatible"`
	Problem          string   `json:"problem,omitempty"`
	InstalledVersion string   `json:"installedVersion,omitempty"`
	UpdateAvailable  bool     `json:"updateAvailable"`
	// NewPermissions lists permissions the release adds over the installed copy.
	NewPermissions []string `json:"newPermissions,omitempty"`
}

// Update is an available update for an installed community plugin.
type Update struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Repo           string   `json:"repo"`
	Current        string   `json:"current"`
	Latest         string   `json:"latest"`
	NewPermissions []string `json:"newPermissions,omitempty"`
	Problem        string   `json:"problem,omitempty"`
}

// GitHubSource is the plugin_state.source value for registry installs.
func GitHubSource(repo string) string { return "github:" + repo }

func repoFromSource(source string) (string, bool) {
	repo, ok := strings.CutPrefix(source, "github:")
	return repo, ok && repoRe.MatchString(repo)
}

func (m *Manager) get(ctx context.Context, rawURL string, limit int64, accept string) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, 0, err
	}
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	req.Header.Set("User-Agent", "Noteral/"+m.appVersion+" (+plugin-store)")
	resp, err := m.http.Do(req)
	if err != nil {
		var uerr *url.Error
		if errors.As(err, &uerr) {
			err = uerr.Err
		}
		return nil, 0, fmt.Errorf("could not reach %s: %v", req.URL.Host, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, resp.StatusCode, fmt.Errorf("%s returned HTTP %d", req.URL.Host, resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	if int64(len(data)) > limit {
		return nil, resp.StatusCode, fmt.Errorf("download from %s is too large", req.URL.Host)
	}
	return data, resp.StatusCode, nil
}

// ParseRegistry validates community-plugins.json. Accepted shapes: a bare
// array of entries, or {"plugins": [...]}. Invalid entries are skipped and
// counted so one bad PR cannot break the store.
func ParseRegistry(data []byte) ([]RegistryEntry, int, error) {
	var entries []RegistryEntry
	trimmed := strings.TrimSpace(string(data))
	if strings.HasPrefix(trimmed, "{") {
		var wrapped struct {
			Plugins []RegistryEntry `json:"plugins"`
		}
		if err := json.Unmarshal(data, &wrapped); err != nil {
			return nil, 0, fmt.Errorf("registry is not valid JSON")
		}
		entries = wrapped.Plugins
	} else if err := json.Unmarshal(data, &entries); err != nil {
		return nil, 0, fmt.Errorf("registry is not valid JSON")
	}
	if len(entries) > maxRegistryEntries {
		return nil, 0, fmt.Errorf("registry has too many entries")
	}
	seen := map[string]bool{}
	out := make([]RegistryEntry, 0, len(entries))
	skipped := 0
	for _, e := range entries {
		e.ID = strings.TrimSpace(e.ID)
		e.Name = strings.TrimSpace(e.Name)
		e.Repo = strings.TrimSpace(e.Repo)
		e.Author = strings.TrimSpace(e.Author)
		e.Description = strings.TrimSpace(e.Description)
		if !idRe.MatchString(e.ID) || len(e.ID) > 100 || e.Name == "" || len([]rune(e.Name)) > 80 ||
			!repoRe.MatchString(e.Repo) || seen[e.ID] || len([]rune(e.Description)) > 500 {
			skipped++
			continue
		}
		if len(e.Tags) > 8 {
			e.Tags = e.Tags[:8]
		}
		seen[e.ID] = true
		out = append(out, e)
	}
	return out, skipped, nil
}

// FetchRegistry downloads and validates a community registry. It never
// installs or executes anything.
func (m *Manager) FetchRegistry(rawURL string) (RegistryResult, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		rawURL = DefaultRegistryURL
	}
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return RegistryResult{}, fmt.Errorf("enter an http(s) registry URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	data, _, err := m.get(ctx, u.String(), maxRegistryBytes, "application/json")
	if err != nil {
		return RegistryResult{}, err
	}
	entries, skipped, err := ParseRegistry(data)
	if err != nil {
		return RegistryResult{}, err
	}
	states, _ := m.states()
	out := make([]CommunityPlugin, 0, len(entries))
	for _, e := range entries {
		st, ok := states[e.ID]
		repo, fromGitHub := repoFromSource(st.source)
		out = append(out, CommunityPlugin{
			RegistryEntry:         e,
			Installed:             ok && st.installedAt != "",
			InstalledVersion:      st.version,
			Enabled:               st.enabled,
			InstalledFromRegistry: fromGitHub && strings.EqualFold(repo, e.Repo),
		})
	}
	sort.SliceStable(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return RegistryResult{URL: u.String(), FetchedAt: time.Now().UTC().Format(time.RFC3339), Plugins: out, Skipped: skipped}, nil
}

func (m *Manager) releaseAssetURL(repo, name string) string {
	return fmt.Sprintf("%s/%s/releases/latest/download/%s", strings.TrimRight(m.githubBase, "/"), repo, name)
}

type releaseAssets struct {
	manifestRaw []byte
	manifest    Manifest
	code        []byte
	styles      []byte
}

// downloadRelease fetches manifest.json, the entry file, and an optional
// styles.css from the repo's latest GitHub Release. The /releases/latest/download
// redirect is not rate-limited the way the REST API is.
func (m *Manager) downloadRelease(ctx context.Context, repo string, withCode bool) (releaseAssets, error) {
	var out releaseAssets
	if !repoRe.MatchString(repo) {
		return out, fmt.Errorf("repo must look like owner/name")
	}
	data, status, err := m.get(ctx, m.releaseAssetURL(repo, ManifestFile), 256<<10, "application/octet-stream")
	if err != nil {
		if status == http.StatusNotFound {
			return out, fmt.Errorf("%s has no release with a manifest.json asset", repo)
		}
		return out, err
	}
	man, err := parseNamedManifest(ManifestFile, data)
	if err != nil {
		return out, fmt.Errorf("%s: %w", repo, err)
	}
	out.manifestRaw, out.manifest = data, man
	if !withCode {
		return out, nil
	}
	entry := man.Entry
	if strings.Contains(entry, "/") {
		return out, fmt.Errorf("release plugins must ship their entry (%s) as a top-level release asset", entry)
	}
	code, status, err := m.get(ctx, m.releaseAssetURL(repo, entry), maxReleaseAsset, "application/octet-stream")
	if err != nil {
		if status == http.StatusNotFound {
			return out, fmt.Errorf("release is missing the %s asset", entry)
		}
		return out, err
	}
	out.code = code
	css, status, err := m.get(ctx, m.releaseAssetURL(repo, StylesFile), maxStylesBytes, "application/octet-stream")
	if err == nil {
		out.styles = css
	} else if status != http.StatusNotFound {
		return out, err
	}
	return out, nil
}

type ghRelease struct {
	TagName     string `json:"tag_name"`
	Body        string `json:"body"`
	PublishedAt string `json:"published_at"`
	HTMLURL     string `json:"html_url"`
	Assets      []struct {
		Name string `json:"name"`
	} `json:"assets"`
}

// releaseNotes asks the GitHub REST API for notes. It is best-effort: the
// unauthenticated API is rate limited, so failures are ignored.
func (m *Manager) releaseNotes(ctx context.Context, repo string) (ghRelease, bool) {
	var rel ghRelease
	data, _, err := m.get(ctx, fmt.Sprintf("%s/repos/%s/releases/latest", strings.TrimRight(m.githubAPI, "/"), repo), 1<<20, "application/vnd.github+json")
	if err != nil || json.Unmarshal(data, &rel) != nil {
		return rel, false
	}
	if len(rel.Body) > 8000 {
		rel.Body = rel.Body[:8000] + "…"
	}
	return rel, true
}

// FetchRelease reads the latest release of a community plugin for the details
// pane and the permission prompt.
func (m *Manager) FetchRelease(repo, expectedID string) (Release, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	assets, err := m.downloadRelease(ctx, repo, false)
	if err != nil {
		return Release{}, err
	}
	man := assets.manifest
	if expectedID != "" && man.ID != expectedID {
		return Release{}, fmt.Errorf("release manifest id %q does not match the registry id %q", man.ID, expectedID)
	}
	rel := Release{Repo: repo, Manifest: man, HTMLURL: fmt.Sprintf("https://github.com/%s", repo)}
	if gh, ok := m.releaseNotes(ctx, repo); ok {
		rel.Tag, rel.Notes, rel.PublishedAt = gh.TagName, gh.Body, gh.PublishedAt
		if gh.HTMLURL != "" {
			rel.HTMLURL = gh.HTMLURL
		}
		for _, a := range gh.Assets {
			if a.Name == StylesFile {
				rel.HasStyles = true
			}
		}
	}
	rel.Problem = m.compatibility(man)
	rel.Compatible = rel.Problem == ""
	m.annotateInstalled(&rel)
	return rel, nil
}

func (m *Manager) annotateInstalled(rel *Release) {
	states, _ := m.states()
	st, ok := states[rel.Manifest.ID]
	if !ok {
		return
	}
	rel.InstalledVersion = st.version
	rel.UpdateAvailable = CompareVersions(rel.Manifest.Version, st.version) > 0
	if data, err := readFileLimited(m.info.PluginsDir, rel.Manifest.ID, LegacyManifestFile); err == nil {
		if old, err := parseManifest(data); err == nil {
			rel.NewPermissions = MissingPermissions(rel.Manifest.Permissions, old.Permissions)
		}
	}
}

// InstallFromGitHub installs or updates a community plugin from its latest
// GitHub Release. approved must cover every permission in the release manifest.
func (m *Manager) InstallFromGitHub(repo, expectedID string, approved []string) (Info, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	assets, err := m.downloadRelease(ctx, repo, true)
	if err != nil {
		return Info{}, err
	}
	files := map[string][]byte{
		ManifestFile:          assets.manifestRaw,
		assets.manifest.Entry: assets.code,
	}
	if len(assets.styles) > 0 {
		files[StylesFile] = assets.styles
	}
	return m.installFiles(files, GitHubSource(repo), installOptions{approved: approved, allowUpdate: true, expectedID: expectedID, enable: true})
}

// CheckUpdates looks up the latest release of every plugin installed from
// GitHub. Lookups run with small concurrency; per-plugin failures are reported
// in Update.Problem instead of failing the whole check.
func (m *Manager) CheckUpdates() ([]Update, error) {
	installed, err := m.List()
	if err != nil {
		return nil, err
	}
	type job struct {
		info Info
		repo string
	}
	var jobs []job
	for _, info := range installed {
		if repo, ok := repoFromSource(info.Source); ok {
			jobs = append(jobs, job{info, repo})
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	out := []Update{}
	for _, j := range jobs {
		wg.Add(1)
		go func(j job) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			u := Update{ID: j.info.Manifest.ID, Name: j.info.Manifest.Name, Repo: j.repo, Current: j.info.Manifest.Version}
			assets, err := m.downloadRelease(ctx, j.repo, false)
			if err != nil {
				u.Problem = err.Error()
			} else {
				u.Latest = assets.manifest.Version
				u.NewPermissions = MissingPermissions(assets.manifest.Permissions, j.info.Manifest.Permissions)
				if p := m.compatibility(assets.manifest); p != "" {
					u.Problem = p
				}
				if CompareVersions(u.Latest, u.Current) <= 0 {
					return
				}
			}
			mu.Lock()
			out = append(out, u)
			mu.Unlock()
		}(j)
	}
	wg.Wait()
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func readFileLimited(dir, id, name string) ([]byte, error) {
	if !idRe.MatchString(id) {
		return nil, fmt.Errorf("invalid plugin id")
	}
	f, err := os.Open(filepath.Join(dir, id, name))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(io.LimitReader(f, 1<<20))
}

const maxReadmeBytes = 512 << 10

// Readme is a community plugin's README for the store's details page.
// ImageBase and LinkBase resolve the relative paths READMEs usually use.
type Readme struct {
	Repo      string `json:"repo"`
	Markdown  string `json:"markdown"`
	ImageBase string `json:"imageBase"`
	LinkBase  string `json:"linkBase"`
}

// FetchReadme downloads the README of a plugin repository's default branch.
// It tries the plain file first (no API rate limit), then the GitHub API,
// which also finds readme.md, README and other spellings.
func (m *Manager) FetchReadme(repo string) (Readme, error) {
	repo = strings.TrimSpace(repo)
	if !repoRe.MatchString(repo) {
		return Readme{}, fmt.Errorf("%q is not a GitHub repository (owner/name)", repo)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	base := strings.TrimRight(m.githubBase, "/")
	out := Readme{Repo: repo, ImageBase: fmt.Sprintf("%s/%s/raw/HEAD/", base, repo), LinkBase: fmt.Sprintf("%s/%s/blob/HEAD/", base, repo)}
	data, _, err := m.get(ctx, fmt.Sprintf("%s/%s/raw/HEAD/README.md", base, repo), maxReadmeBytes, "")
	if err != nil {
		var status int
		data, status, err = m.get(ctx, fmt.Sprintf("%s/repos/%s/readme", strings.TrimRight(m.githubAPI, "/"), repo), maxReadmeBytes, "application/vnd.github.raw")
		if status == http.StatusNotFound {
			return out, nil
		}
		if err != nil {
			return Readme{}, err
		}
	}
	out.Markdown = strings.ToValidUTF8(string(data), "")
	return out, nil
}
