package main

import (
	"embed"
	"log"
	"net/http"
	"os"
	"runtime"
	"strings"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"noteral/internal/assets"
	"noteral/internal/datadir"
	"noteral/internal/plugins"
	"noteral/internal/service"
	"noteral/internal/store"
	"noteral/internal/web"
)

//go:embed all:frontend/dist
var embeddedFrontend embed.FS

func main() {
	dataDir := parseDataDir(os.Args[1:])
	info, err := datadir.Resolve(dataDir)
	if err != nil {
		log.Fatalf("Noteral could not start: %v", err)
	}

	st, err := store.Open(info)
	if err != nil {
		log.Fatalf("Noteral could not open its data: %v", err)
	}
	defer st.Close()

	assetManager := assets.New(info)
	pluginManager := plugins.New(st, info)
	svc := service.New(st, assetManager, pluginManager, info)
	browserFrame := service.BrowserFrame(svc)

	app := application.New(application.Options{
		Name:        "Noteral",
		Description: "A local-first notes workspace",
		Services: []application.Service{
			application.NewService(svc),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(embeddedFrontend),
			Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if strings.HasPrefix(r.URL.Path, "/__assets/") {
						assetManager.ServeHTTP(w, r)
						return
					}
					if r.URL.Path == web.FramePath || strings.HasPrefix(r.URL.Path, web.ResourcePath) {
						browserFrame.ServeHTTP(w, r)
						return
					}
					next.ServeHTTP(w, r)
				})
			},
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		OnShutdown: func() {
			_ = st.Close()
		},
	})
	svc.SetApp(app)
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		application.InvokeSync(enableFrameCORS)
	})

	windowOptions := application.WebviewWindowOptions{
		Name:             "main",
		Title:            "Noteral",
		Width:            1280,
		Height:           820,
		MinWidth:         860,
		MinHeight:        560,
		URL:              "/",
		BackgroundColour: application.NewRGB(250, 248, 244),
		Frameless:        runtime.GOOS != "darwin",
	}
	if runtime.GOOS == "darwin" {
		// Keep the native traffic lights while letting the app draw its own
		// draggable title bar underneath them.
		windowOptions.Mac = application.MacWindow{
			TitleBar:                application.MacTitleBarHiddenInset,
			InvisibleTitleBarHeight: 44,
			Backdrop:                application.MacBackdropNormal,
		}
	}
	window := app.Window.NewWithOptions(windowOptions)

	setupCloseFlush(app, window, svc)
	go maybeStartDevAssetServer(assetManager)

	if err := app.Run(); err != nil {
		log.Printf("Noteral stopped with an error: %v", err)
	}
}

// parseDataDir accepts both --data-dir <path> and --data-dir=<path> without
// consuming arbitrary flags a desktop launcher may append.
func parseDataDir(args []string) string {
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--data-dir" && i+1 < len(args) {
			return args[i+1]
		}
		if strings.HasPrefix(a, "--data-dir=") {
			return strings.TrimPrefix(a, "--data-dir=")
		}
	}
	return ""
}

// setupCloseFlush coordinates the asynchronous renderer flush with the native
// close event. The first close is cancelled, the frontend flushes dirty editors
// and calls FlushDone, then the close is reissued after a short hard limit.
func setupCloseFlush(app *application.App, window *application.WebviewWindow, svc *service.AppService) {
	var closing atomic.Bool
	var force atomic.Bool
	window.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		if force.Load() {
			return
		}
		e.Cancel()
		if closing.CompareAndSwap(false, true) {
			app.Event.Emit("noteral:before-close")
			go func() {
				svc.WaitForFlush(3500 * time.Millisecond)
				force.Store(true)
				window.Close()
			}()
		}
	})
}

// In Wails development mode the renderer is served by Vite, so the Go asset
// middleware is not on the request path. Vite proxies /__assets to this tiny
// local server (see frontend/vite.config.ts). Production uses the middleware.
func maybeStartDevAssetServer(am *assets.Manager) {
	if os.Getenv("FRONTEND_DEVSERVER_URL") == "" {
		return
	}
	mux := http.NewServeMux()
	mux.Handle("/__assets/", am)
	addr := "127.0.0.1:9246"
	log.Printf("Noteral dev asset server listening on http://%s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Printf("Noteral dev asset server stopped: %v", err)
	}
}
