# Hero TD -- development server.
#
# python -m http.server is fine except for one thing: it lets the browser cache
# ES modules, and a cached module survives a hard reload. That turns every edit
# into a guessing game about whether you are looking at your change or at the
# last one. No-store on everything costs nothing at this scale.
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass            # the dev overlay is the log that matters


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8124
    print(f'hero-td dev server on http://localhost:{port}')
    ThreadingHTTPServer(('127.0.0.1', port), NoCacheHandler).serve_forever()
