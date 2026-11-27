package plugins

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// fakeGitHub serves a registry plus the /releases/latest/download/<asset>
// redirect targets GitHub exposes for every public repo.
type fakeGitHub struct {
	mu     sync.Mutex
	assets map[string]map[string]string // repo -> asset -> body
}

func (f *fakeGitHub) set(repo, asset, body string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.assets[repo] == nil {
		f.assets[repo] = map[string]string{}
	}
	f.assets[repo][asset] = body
}

func (f *fakeGitHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if r.URL.Path == "/registry.json" {
		fmt.Fprint(w, `[
			{"id":"com.example.hello","name":"Hello","author":"Ada","description":"Says hello","repo":"ada/noteral-hello"},
			{"id":"not valid","name":"Broken","repo":"x/y"},
			{"id":"com.example.norepo","name":"No repo","repo":"bad"}
		]`)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/repos/") {
		http.NotFound(w, r) // simulate API rate limiting / absence: notes are optional
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/"), "/")
	// owner/name/raw/HEAD/README.md
	if len(parts) == 5 && parts[2] == "raw" && parts[3] == "HEAD" {
		if body, ok := f.assets[parts[0]+"/"+parts[1]]["readme:"+parts[4]]; ok {
			fmt.Fprint(w, body)
			return
		}
	}
	// owner/name/releases/latest/download/asset
	if len(parts) == 6 && parts[2] == "releases" && parts[4] == "download" {
		if body, ok := f.assets[parts[0]+"/"+parts[1]][parts[5]]; ok {
			fmt.Fprint(w, body)
			return
		}
	}
	http.NotFound(w, r)
}

func helloManifest(version string, perms ...string) string {
	quoted := make([]string, len(perms))
	for i, p := range perms {
		quoted[i] = fmt.Sprintf("%q", p)
	}
	return fmt.Sprintf(`{"id":"com.example.hello","name":"Hello","version":%q,"minAppVersion":"0.1.0","author":"Ada","description":"Says hello","permissions":[%s]}`,
		version, strings.Join(quoted, ","))
}

func TestCommunityRegistryInstallAndUpdate(t *testing.T) {
	manager, _ := testManager(t)
	manager.SetAppVersion("0.1.0")
	gh := &fakeGitHub{assets: map[string]map[string]string{}}
	srv := httptest.NewServer(gh)
	defer srv.Close()
	manager.githubBase, manager.githubAPI = srv.URL, srv.URL

	reg, err := manager.FetchRegistry(srv.URL + "/registry.json")
	if err != nil {
		t.Fatal(err)
	}
	if len(reg.Plugins) != 1 || reg.Skipped != 2 || reg.Plugins[0].Repo != "ada/noteral-hello" {
		t.Fatalf("unexpected registry: %+v", reg)
	}

	const repo = "ada/noteral-hello"
	gh.set(repo, "manifest.json", helloManifest("1.0.0", "ui.notify"))
	gh.set(repo, "main.js", `Noteral.definePlugin(class extends Noteral.Plugin { onload(){} })`)
	gh.set(repo, "styles.css", `.hello{color:red}`)

	rel, err := manager.FetchRelease(repo, "com.example.hello")
	if err != nil || !rel.Compatible || rel.Manifest.Version != "1.0.0" || rel.UpdateAvailable {
		t.Fatalf("release: %+v %v", rel, err)
	}
	if _, err := manager.FetchRelease(repo, "com.example.other"); err == nil {
		t.Fatal("id mismatch with registry must be rejected")
	}
	if _, err := manager.InstallFromGitHub(repo, "com.example.hello", nil); err == nil {
		t.Fatal("install without approval must fail")
	}
	info, err := manager.InstallFromGitHub(repo, "com.example.hello", []string{"ui.notify"})
	if err != nil {
		t.Fatal(err)
	}
	if !info.Enabled || info.Source != "github:"+repo {
		t.Fatalf("unexpected install: %+v", info)
	}
	rt, err := manager.Runtime("com.example.hello")
	if err != nil || rt.Styles != ".hello{color:red}" || !strings.Contains(rt.Code, "definePlugin") {
		t.Fatalf("runtime: %+v %v", rt, err)
	}
	if _, err := manager.SaveSettings("com.example.hello", map[string]any{"greeting": "hi"}); err != nil {
		t.Fatal(err)
	}

	// Nothing newer yet.
	ups, err := manager.CheckUpdates()
	if err != nil || len(ups) != 0 {
		t.Fatalf("no updates expected: %+v %v", ups, err)
	}

	// Publish 1.1.0 that asks for a new permission.
	gh.set(repo, "manifest.json", helloManifest("1.1.0", "ui.notify", "network"))
	ups, err = manager.CheckUpdates()
	if err != nil || len(ups) != 1 || ups[0].Latest != "1.1.0" || len(ups[0].NewPermissions) != 1 || ups[0].NewPermissions[0] != "network" {
		t.Fatalf("update not detected: %+v %v", ups, err)
	}
	if _, err := manager.InstallFromGitHub(repo, "com.example.hello", []string{"ui.notify"}); err == nil || !strings.Contains(err.Error(), "network") {
		t.Fatalf("update with new unapproved permission must fail, got %v", err)
	}
	if _, err := manager.Toggle("com.example.hello", false); err != nil {
		t.Fatal(err)
	}
	info, err = manager.InstallFromGitHub(repo, "com.example.hello", []string{"ui.notify", "network"})
	if err != nil || info.Manifest.Version != "1.1.0" {
		t.Fatalf("update: %+v %v", info, err)
	}
	if info.Enabled {
		t.Fatal("update must preserve the disabled state")
	}
	settings, _ := manager.GetSettings("com.example.hello")
	if settings["greeting"] != "hi" {
		t.Fatalf("update must preserve settings, got %+v", settings)
	}
	leftovers, _ := filepath.Glob(filepath.Join(manager.info.PluginsDir, ".*"))
	if len(leftovers) != 0 {
		t.Fatalf("temporary folders left behind: %v", leftovers)
	}

	// Downgrades are refused.
	gh.set(repo, "manifest.json", helloManifest("1.0.0", "ui.notify"))
	if _, err := manager.InstallFromGitHub(repo, "com.example.hello", []string{"ui.notify"}); err == nil {
		t.Fatal("downgrade accepted")
	}
}

func TestMinAppVersionIsEnforced(t *testing.T) {
	manager, _ := testManager(t)
	manager.SetAppVersion("0.1.0")
	gh := &fakeGitHub{assets: map[string]map[string]string{}}
	srv := httptest.NewServer(gh)
	defer srv.Close()
	manager.githubBase, manager.githubAPI = srv.URL, srv.URL
	const repo = "ada/future"
	gh.set(repo, "manifest.json", `{"id":"com.example.future","name":"Future","version":"1.0.0","minAppVersion":"9.0.0","permissions":[]}`)
	gh.set(repo, "main.js", `1`)
	rel, err := manager.FetchRelease(repo, "")
	if err != nil || rel.Compatible || !strings.Contains(rel.Problem, "9.0.0") {
		t.Fatalf("expected incompatible release: %+v %v", rel, err)
	}
	if _, err := manager.InstallFromGitHub(repo, "", []string{}); err == nil {
		t.Fatal("incompatible plugin installed")
	}
}

func TestInstallGeneratedPlugin(t *testing.T) {
	useFixtureCatalog(t)
	manager, _ := testManager(t)
	man := Manifest{ID: "com.assistant.word-goal", Name: "Word goal", Version: "1.0.0", Permissions: []string{"editor.read", "ui.status"}}
	if _, err := manager.InstallGenerated(man, "Noteral.definePlugin({onload(){}})", "", []string{"editor.read"}, ""); err == nil {
		t.Fatal("generated plugin installed without approval")
	}
	info, err := manager.InstallGenerated(man, "Noteral.definePlugin({onload(){}})", ".x{}", man.Permissions, "")
	if err != nil || !info.Enabled || info.Source != "assistant" {
		t.Fatalf("install generated: %+v %v", info, err)
	}
	man.Version = "1.0.1"
	if _, err := manager.InstallGenerated(man, "Noteral.definePlugin({onload(){ }})", "", man.Permissions, ""); err != nil {
		t.Fatalf("assistant must be able to update its own plugin: %v", err)
	}
	got, code, _, err := manager.Source(man.ID)
	if err != nil || got.Version != "1.0.1" || !strings.Contains(code, "onload(){ }") {
		t.Fatalf("source: %+v %q %v", got, code, err)
	}
	if _, err := os.Stat(filepath.Join(manager.info.PluginsDir, man.ID, StylesFile)); !os.IsNotExist(err) {
		t.Fatal("styles from the previous version should be gone after an update without styles")
	}
	// A catalog plugin must not be overwritable by generated code.
	useFixtureCatalog(t)
	if _, err := manager.InstallCatalog("com.noteral.meeting-notes", []string{"editor.read", "editor.write", "pages.write", "ui.notify"}); err != nil {
		t.Fatal(err)
	}
	cat := Manifest{ID: "com.noteral.meeting-notes", Name: "Hijack", Version: "9.0.0"}
	if _, err := manager.InstallGenerated(cat, "1", "", []string{}, ""); err == nil {
		t.Fatal("generated code overwrote a catalog plugin")
	}
}

func TestCommunityReadme(t *testing.T) {
	manager, _ := testManager(t)
	gh := &fakeGitHub{assets: map[string]map[string]string{}}
	srv := httptest.NewServer(gh)
	defer srv.Close()
	manager.githubBase, manager.githubAPI = srv.URL, srv.URL

	gh.set("ada/noteral-hello", "readme:README.md", "# Hello\n\n![shot](docs/shot.png)")
	readme, err := manager.FetchReadme("ada/noteral-hello")
	if err != nil || !strings.HasPrefix(readme.Markdown, "# Hello") {
		t.Fatalf("readme: %+v %v", readme, err)
	}
	if readme.ImageBase != srv.URL+"/ada/noteral-hello/raw/HEAD/" || readme.LinkBase != srv.URL+"/ada/noteral-hello/blob/HEAD/" {
		t.Fatalf("bases: %+v", readme)
	}
	// No README anywhere (the fake API answers 404): empty, not an error.
	if empty, err := manager.FetchReadme("ada/none"); err != nil || empty.Markdown != "" {
		t.Fatalf("missing readme: %+v %v", empty, err)
	}
	if _, err := manager.FetchReadme("../etc"); err == nil {
		t.Fatal("bad repo names must be rejected")
	}
}
