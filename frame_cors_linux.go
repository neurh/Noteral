//go:build linux && !android && !server

package main

import (
	"log"

	"github.com/ebitengine/purego"
)

// WebKitGTK builds Wails links against, newest first.
var webkitLibraries = []string{"libwebkitgtk-6.0.so.4", "libwebkit2gtk-4.1.so.0"}

// rtldNoload makes dlopen return a library only if it is already loaded, so
// this never brings in a second WebKit next to the one Wails uses.
const rtldNoload = 0x4

// enableFrameCORS lets in-app browser pages read from the app's resource
// proxy. Those pages run in an opaque origin, so module scripts, fonts and
// fetches they make to the app's wails:// scheme are cross-origin requests,
// which WebKitGTK refuses for custom schemes unless the scheme is marked as
// CORS-enabled. The proxy answers with the CORS headers that make them work.
func enableFrameCORS() {
	for _, name := range webkitLibraries {
		lib, err := purego.Dlopen(name, purego.RTLD_NOW|purego.RTLD_GLOBAL|rtldNoload)
		if err != nil || lib == 0 {
			continue
		}
		getDefault, err1 := purego.Dlsym(lib, "webkit_web_context_get_default")
		getManager, err2 := purego.Dlsym(lib, "webkit_web_context_get_security_manager")
		register, err3 := purego.Dlsym(lib, "webkit_security_manager_register_uri_scheme_as_cors_enabled")
		if err1 != nil || err2 != nil || err3 != nil {
			log.Printf("browser: %s has no CORS scheme registration", name)
			return
		}
		var contextDefault func() uintptr
		var securityManager func(uintptr) uintptr
		var registerCORS func(uintptr, string)
		purego.RegisterFunc(&contextDefault, getDefault)
		purego.RegisterFunc(&securityManager, getManager)
		purego.RegisterFunc(&registerCORS, register)
		if ctx := contextDefault(); ctx != 0 {
			if manager := securityManager(ctx); manager != 0 {
				registerCORS(manager, "wails")
			}
		}
		return
	}
}
