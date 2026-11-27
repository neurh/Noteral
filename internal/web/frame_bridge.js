(function () {
  "use strict";
  var config = window.__noteralFrame || {};
  var parent = window.parent;
  if (!parent || parent === window) return;
  var base = config.url || "";

  function send(message) {
    message.source = "noteral-browse";
    try {
      parent.postMessage(message, "*");
    } catch (error) {}
  }
  function absolute(href) {
    try {
      return new URL(href, base || document.baseURI).href;
    } catch (error) {
      return "";
    }
  }
  function samePage(target) {
    try {
      var a = new URL(target);
      var b = new URL(base);
      return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search && !!a.hash;
    } catch (error) {
      return false;
    }
  }

  // The page runs in an opaque origin, where touching storage or cookies
  // throws. Give it in-memory stand-ins so ordinary sites keep working.
  function memoryStorage() {
    var data = {};
    return {
      get length() { return Object.keys(data).length; },
      key: function (i) { return Object.keys(data)[i] || null; },
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); },
      removeItem: function (k) { delete data[k]; },
      clear: function () { data = {}; },
    };
  }
  ["localStorage", "sessionStorage"].forEach(function (name) {
    try {
      window[name].length;
    } catch (error) {
      try {
        Object.defineProperty(window, name, { value: memoryStorage(), configurable: true });
      } catch (ignored) {}
    }
  });
  try {
    document.cookie;
  } catch (error) {
    var jar = {};
    try {
      Object.defineProperty(document, "cookie", {
        configurable: true,
        get: function () {
          return Object.keys(jar).map(function (k) { return k + "=" + jar[k]; }).join("; ");
        },
        set: function (value) {
          var pair = String(value).split(";")[0];
          var at = pair.indexOf("=");
          if (at > 0) jar[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
        },
      });
    } catch (ignored) {}
  }

  // Storage the opaque origin refuses outright: answer with empty stand-ins
  // instead of the SecurityError that stops some sites from rendering.
  function guard(target, name, value) {
    try {
      target[name];
    } catch (error) {
      try {
        Object.defineProperty(target, name, { value: value, configurable: true });
      } catch (ignored) {}
    }
  }
  function memoryCache() {
    var entries = [];
    function find(request) {
      var url = typeof request === "string" ? absolute(request) : request && request.url;
      for (var i = 0; i < entries.length; i++) if (entries[i].url === url) return i;
      return -1;
    }
    return {
      match: function (request) {
        var at = find(request);
        return Promise.resolve(at < 0 ? undefined : entries[at].response.clone());
      },
      matchAll: function () { return Promise.resolve(entries.map(function (e) { return e.response.clone(); })); },
      put: function (request, response) {
        var at = find(request);
        var entry = { url: typeof request === "string" ? absolute(request) : request.url, response: response };
        if (at < 0) entries.push(entry);
        else entries[at] = entry;
        return Promise.resolve();
      },
      add: function () { return Promise.resolve(); },
      addAll: function () { return Promise.resolve(); },
      delete: function (request) {
        var at = find(request);
        if (at >= 0) entries.splice(at, 1);
        return Promise.resolve(at >= 0);
      },
      keys: function () { return Promise.resolve(entries.map(function (e) { return new Request(e.url); })); },
    };
  }
  var cacheStore = {};
  guard(window, "caches", {
    open: function (name) {
      if (!cacheStore[name]) cacheStore[name] = memoryCache();
      return Promise.resolve(cacheStore[name]);
    },
    has: function (name) { return Promise.resolve(!!cacheStore[name]); },
    delete: function (name) {
      var had = !!cacheStore[name];
      delete cacheStore[name];
      return Promise.resolve(had);
    },
    keys: function () { return Promise.resolve(Object.keys(cacheStore)); },
    match: function () { return Promise.resolve(undefined); },
  });
  guard(navigator, "serviceWorker", undefined);

  // fetch, XMLHttpRequest, beacons and event streams are CORS requests, and
  // sites don't accept the page's opaque origin. Send them through the app's
  // resource proxy, which makes the same request with the page's cookies and
  // lets the page read the answer.
  var appBase = location.protocol + "//" + location.host;
  var resourcePath = "/__browse/r/";
  function proxied(target) {
    var u;
    try {
      u = new URL(String(target), base || document.baseURI);
    } catch (error) {
      return "";
    }
    if (u.protocol + "//" + u.host === appBase) {
      // Scripts that build addresses from location get the app's own
      // origin back; anything outside the proxy was meant for the site.
      if (u.pathname.indexOf("/__browse") === 0) return "";
      try {
        u = new URL(u.pathname + u.search, base);
      } catch (error) {
        return "";
      }
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return appBase + resourcePath + u.protocol.slice(0, -1) + "/" + u.host + u.pathname + u.search;
  }
  function unsafe(method) {
    return !/^(get|head)$/i.test(method || "GET");
  }
  var nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = function (input, init) {
      var isRequest = typeof Request !== "undefined" && input instanceof Request;
      var url = isRequest ? input.url : input instanceof URL ? input.href : String(input);
      var to = proxied(url);
      if (!to) return nativeFetch.apply(this, arguments);
      var options = {};
      var key;
      if (isRequest) {
        options = { method: input.method, headers: new Headers(input.headers), credentials: input.credentials, cache: input.cache, redirect: input.redirect, signal: input.signal, referrerPolicy: input.referrerPolicy };
      }
      if (init) for (key in init) options[key] = init[key];
      var headers = new Headers(options.headers || undefined);
      if (unsafe(options.method)) headers.set("X-Noteral-Page", base);
      options.headers = headers;
      if (options.mode === "navigate" || options.mode === "same-origin") delete options.mode;
      if (isRequest && unsafe(options.method) && !(init && "body" in init)) {
        return input.clone().arrayBuffer().then(function (body) {
          options.body = body;
          return nativeFetch(to, options);
        });
      }
      return nativeFetch(to, options);
    };
  }
  if (typeof XMLHttpRequest !== "undefined") {
    var xhrOpen = XMLHttpRequest.prototype.open;
    var xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      var args = Array.prototype.slice.call(arguments);
      var to = proxied(url);
      this.__noteralPage = false;
      if (to) {
        args[1] = to;
        this.__noteralPage = unsafe(method);
      }
      return xhrOpen.apply(this, args);
    };
    XMLHttpRequest.prototype.send = function () {
      if (this.__noteralPage) {
        try {
          this.setRequestHeader("X-Noteral-Page", base);
        } catch (error) {}
      }
      return xhrSend.apply(this, arguments);
    };
  }
  if (navigator.sendBeacon) {
    var beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      return beacon(proxied(url) || url, data);
    };
  }
  if (typeof EventSource !== "undefined") {
    var NativeEventSource = EventSource;
    window.EventSource = function (url, options) {
      return new NativeEventSource(proxied(url) || url, options);
    };
    window.EventSource.prototype = NativeEventSource.prototype;
  }

  // Single-page sites change the address with the History API. The document
  // itself lives at the app's /__browse address, so the real call would throw;
  // keep the state and tell the app the new address instead.
  ["pushState", "replaceState"].forEach(function (name) {
    var original = history[name];
    if (typeof original !== "function") return;
    history[name] = function (state, title, url) {
      try {
        original.call(history, state, title);
      } catch (error) {}
      if (url != null && url !== "") {
        var next = absolute(String(url));
        if (/^https?:/i.test(next)) {
          base = next;
          send({ type: "location", url: next, soft: name === "pushState" ? "push" : "replace" });
        }
      }
    };
  });

  window.open = function (url) {
    var target = absolute(url == null ? "" : String(url));
    if (/^https?:/i.test(target)) send({ type: "navigate", url: target, newTab: true });
    return null;
  };

  function linkFrom(event) {
    var node = event.target;
    while (node && node.nodeType !== 1) node = node.parentNode;
    return node && node.closest ? node.closest("a[href], area[href]") : null;
  }
  function onClick(event) {
    if (event.defaultPrevented || event.button > 1) return;
    var link = linkFrom(event);
    if (!link || link.hasAttribute("download")) return;
    var href = link.getAttribute("href") || "";
    if (!href || /^\s*javascript:/i.test(href)) return;
    if (href.charAt(0) === "#") return;
    var target = absolute(href);
    if (!/^https?:/i.test(target)) return;
    if (samePage(target)) return;
    event.preventDefault();
    var newTab = event.ctrlKey || event.metaKey || event.button === 1 || link.target === "_blank";
    send({ type: "navigate", url: target, newTab: !!newTab, background: !!(event.ctrlKey || event.metaKey || event.button === 1) });
  }
  document.addEventListener("click", onClick, true);
  document.addEventListener("auxclick", function (event) {
    if (event.button === 1) onClick(event);
  }, true);

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form || event.defaultPrevented) return;
    var method = (form.getAttribute("method") || "get").toLowerCase();
    // Pages load through a GET-only proxy. Search boxes that POST (DuckDuckGo's
    // HTML page does) work just as well as GET; sign-in and upload forms don't,
    // so those go to the site itself in a new window.
    if (method !== "get") {
      if (form.querySelector("input[type=password], input[type=file]")) {
        event.preventDefault();
        send({ type: "navigate", url: absolute(form.getAttribute("action") || base), external: true });
        return;
      }
    }
    var action = absolute(form.getAttribute("action") || base);
    if (!/^https?:/i.test(action)) return;
    event.preventDefault();
    var url = new URL(action);
    var data;
    try {
      data = new FormData(form, event.submitter || undefined);
    } catch (error) {
      data = new FormData(form);
    }
    var params = new URLSearchParams();
    data.forEach(function (value, key) {
      if (typeof value === "string") params.append(key, value);
    });
    url.search = params.toString();
    send({ type: "navigate", url: url.href, newTab: form.target === "_blank" });
  }, true);

  // Scripts that move the page on their own (location.href = …, meta refresh)
  // would leave the proxy and hit the site's frame block. Where the browser
  // has the Navigation API, catch those and hand them to the app too.
  if (window.navigation && typeof window.navigation.addEventListener === "function") {
    window.navigation.addEventListener("navigate", function (event) {
      if (!event.cancelable || event.hashChange || event.downloadRequest || event.navigationType === "traverse") return;
      if (event.formData) return;
      var target = event.destination && event.destination.url;
      if (!target || !/^https?:/i.test(target)) return;
      try {
        var dest = new URL(target);
        // Reloads and moves within the proxy load fine on their own.
        if (dest.protocol + "//" + dest.host === appBase && dest.pathname.indexOf("/__browse") === 0) return;
        if (dest.origin === location.origin) return;
        if (dest.protocol + "//" + dest.host === appBase) target = new URL(dest.pathname + dest.search + dest.hash, base).href;
      } catch (error) {
        return;
      }
      event.preventDefault();
      send({ type: "navigate", url: target, newTab: false, replace: event.navigationType === "replace" });
    });
  }

  // Browser shortcuts keep working while the page has focus.
  document.addEventListener("keydown", function (event) {
    var key = event.key;
    var mod = event.ctrlKey || event.metaKey;
    var wanted =
      key === "F5" || key === "F6" ||
      (event.altKey && (key === "ArrowLeft" || key === "ArrowRight")) ||
      (mod && /^[lrtwkpj\[\]]$/i.test(key)) ||
      (mod && event.shiftKey && /^o$/i.test(key));
    if (!wanted) return;
    event.preventDefault();
    send({ type: "key", key: key, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey });
  }, true);

  window.addEventListener("message", function (event) {
    if (event.source !== parent) return;
    var data = event.data || {};
    if (data.type === "noteral-selection") {
      var selection = window.getSelection();
      var html = "";
      if (selection && selection.rangeCount) {
        var holder = document.createElement("div");
        for (var i = 0; i < selection.rangeCount; i++) holder.appendChild(selection.getRangeAt(i).cloneContents());
        html = holder.innerHTML;
      }
      send({ type: "selection", id: data.id, text: selection ? String(selection) : "", html: html });
    }
  });

  function icon() {
    var link = document.querySelector("link[rel~='icon'][href], link[rel='apple-touch-icon'][href]");
    return link ? absolute(link.getAttribute("href")) : "";
  }
  function ready() {
    send({ type: "page", url: base, status: config.status || 0, error: config.error || "", title: document.title || "", icon: icon() });
  }
  send({ type: "location", url: base, status: config.status || 0, error: config.error || "" });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
  var lastTitle = null;
  function watchTitle() {
    var head = document.head || document.documentElement;
    lastTitle = document.title || "";
    new MutationObserver(function () {
      var title = document.title || "";
      if (title === lastTitle) return;
      lastTitle = title;
      send({ type: "title", title: title });
    }).observe(head, { subtree: true, childList: true, characterData: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchTitle);
  else watchTitle();
})();
