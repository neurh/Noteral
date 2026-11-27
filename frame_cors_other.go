//go:build !linux || android || server

package main

// enableFrameCORS is only needed on WebKitGTK; the other webviews let a
// custom scheme answer cross-origin requests with ordinary CORS headers.
func enableFrameCORS() {}
