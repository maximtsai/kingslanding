# Hero TD -- development server.
#
# python -m http.server is fine except for one thing: it lets the browser cache
# ES modules, and a cached module survives a hard reload. That turns every edit
# into a guessing game about whether you are looking at your change or at the
# last one. No-store on everything costs nothing at this scale.
#
# It also serves ONE write endpoint, POST /api/save-levels, which is how
# tools/level-editor.html puts a level back on disk. See SAVING below.
import io
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# ---------------------------------------------------------------------------
# SAVING
#
# A browser page cannot write to disk, so the editor POSTs JSON here and this
# writes the file. That turns a localhost dev server into something that
# modifies the repo, which is worth three specific guards:
#
#   1. The target path is a CONSTANT. It is never read from the request, so no
#      request can talk this into writing somewhere else. A second writable
#      file means a second constant here, added deliberately.
#   2. Origin is checked and application/json is required. Any page you visit
#      in the same browser can POST to localhost -- a form post is a "simple
#      request", is not preflighted, and would land even though the attacker
#      cannot read the reply. Requiring application/json forces a preflight we
#      never answer, and the Origin check refuses anything but this server.
#   3. The write is atomic: temp file, fsync, os.replace. A crash halfway
#      through cannot leave level-data.js half-written, which matters because
#      the game imports it as a module -- a truncated file is a syntax error at
#      load rather than a bad level.
#
# The previous contents are kept alongside as .bak. That is a courtesy, not a
# safety net: git is the real undo, so commit before an editing session.
LEVEL_DATA_PATH = os.path.join('src', 'sim', 'level-data.js')
MAX_BODY = 1 << 20              # 1 MB. The three levels are about 4 KB.
TIERS = (0, 1, 2, 3)

# The prose blocks of the generated file. They live here because this is what
# writes the file -- keeping them in level-data.js would mean reading the file
# we are about to overwrite in order to know how to overwrite it.
LEVEL_DATA_HEADER = """// Hero TD -- level data.
//
// GENERATED FILE -- DO NOT EDIT BY HAND.
//
// This file is machine-owned. tools/level-editor.html overwrites it wholesale
// through the dev server's save endpoint, so hand edits made here are lost on
// the next save. Everything that explains WHY a level is shaped the way it is
// lives in levels.js, which imports this and is never written by the tool.
//
// If you are reading this to find out how a level works, you are in the wrong
// file. Open levels.js.
//
// SCHEMA
//
// Each entry is keyed by its own id, and carries:
//
//   id             the key again -- board.validate() names it in error messages
//   name           display name
//   heights        square int array, indexed [j][i] (row then column) so the
//                  array as written reads like the island looks from above.
//                  0 = water, 1..3 = land tier
//   ramps          [[lowI, lowJ], [highI, highJ]] pairs. Both ends are named
//                  explicitly: inferring a ramp's direction from neighbour
//                  heights is ambiguous the moment it touches two tiers at
//                  once. Validated at load -- see board.js, which throws if a
//                  pair is not orthogonally adjacent or does not span exactly
//                  one tier.
//   houses         author-placed house tiles
//   shoreFallback  where a landing party comes ashore. P0 used these as walker
//                  spawns; P1 replaced them with boat landing resolution (TDD
//                  11) and keeps them only as the authored fallback that
//                  guarantees a wave can never fail to spawn. Boats normally
//                  pick from the beaches landing.js enumerates, so this list is
//                  the floor rather than the usual path -- and every tile in it
//                  must be tier-1 land.
//   reserved       optional. Tiles kept clear of structures.
//   intro          optional arrival cutscene, { from, land }. `from` is in tile
//                  coordinates and deliberately off the board; `land` is the
//                  beach it grounds against. A level without this block opens
//                  straight on castle siting -- only level one has it, because
//                  you arrive at the realm once.
//   heroSpawn      starting tile
//   notes          optional free text. Round-tripped by the editor and ignored
//                  by the game -- somewhere to leave a remark next to a level
//                  without touching levels.js.
"""

LEVEL_ORDER_PROSE = """
// Play order. The WON phase advances along this list; the last entry ends the
// run (TDD 18: three tuned levels, not a generator). Editable by the tool,
// because a level the order does not name is a level nobody can reach."""


def num(x):
    """Emit ints as ints. Only intro coordinates are ever fractional."""
    if isinstance(x, bool):
        raise ValueError('boolean where a number was expected')
    if isinstance(x, int):
        return str(x)
    if isinstance(x, float):
        return str(int(x)) if x.is_integer() and abs(x) < 1e15 else repr(x)
    raise ValueError('not a number: %r' % (x,))


def js_str(s):
    """Single-quoted, because that is what the rest of the codebase uses.

    json.dumps would be shorter and would emit double quotes, which turns every
    save into a diff against the house style.
    """
    if not isinstance(s, str):
        raise ValueError('not a string: %r' % (s,))
    body = (s.replace('\\', '\\\\')
             .replace("'", "\\'")
             .replace('\n', '\\n')
             .replace('\r', '\\r')
             .replace('\t', '\\t')
             .replace('\u2028', '\\u2028')       # both are line terminators to a
             .replace('\u2029', '\\u2029'))      # JS parser but not to Python
    return "'" + ''.join(c if ord(c) >= 0x20 else '\\u%04x' % ord(c) for c in body) + "'"


def pair(p):
    return '[' + ', '.join(num(v) for v in p) + ']'


def pair_list(name, pairs):
    return '    ' + name + ': [' + ', '.join(pair(p) for p in pairs) + ']'


def serialize(levels, order):
    """Render the editor's JSON back into the exact shape of level-data.js.

    Field order is fixed here rather than taken from the incoming object, so a
    save re-orders nothing and the diff after an edit shows only what changed.
    """
    out = [LEVEL_DATA_HEADER, 'export const LEVEL_DATA = {', '']

    for idx, lid in enumerate(order):
        lv = levels[lid]
        out.append('  %s: {' % lid)
        out.append('    id: %s,' % js_str(lv['id']))
        out.append('    name: %s,' % js_str(lv['name']))

        rows = lv['heights']
        out.append('    heights: [')
        for r, row in enumerate(rows):
            comma = '' if r == len(rows) - 1 else ','
            out.append('      [' + ', '.join(num(v) for v in row) + ']' + comma)
        out.append('    ],')

        ramps = lv['ramps']
        out.append('    ramps: [')
        for r, (low, high) in enumerate(ramps):
            comma = '' if r == len(ramps) - 1 else ','
            out.append('      [%s, %s]%s' % (pair(low), pair(high), comma))
        out.append('    ],')

        out.append(pair_list('houses', lv['houses']) + ',')
        out.append(pair_list('shoreFallback', lv['shoreFallback']) + ',')
        if lv.get('reserved'):
            out.append(pair_list('reserved', lv['reserved']) + ',')
        if lv.get('intro'):
            intro = lv['intro']
            out.append('    intro: { from: %s, land: %s },'
                       % (pair(intro['from']), pair(intro['land'])))
        out.append('    heroSpawn: %s%s'
                   % (pair(lv['heroSpawn']), ',' if lv.get('notes') else ''))
        if lv.get('notes'):
            out.append('    notes: %s' % js_str(lv['notes']))

        out.append('  }' + ('' if idx == len(order) - 1 else ','))
        if idx != len(order) - 1:
            out.append('')

    out.append('};')
    out.append(LEVEL_ORDER_PROSE)
    out.append('export const LEVEL_ORDER = ['
               + ', '.join(js_str(i) for i in order) + '];')
    return '\n'.join(out) + '\n'


def check_shape(levels, order):
    """Structural sanity only -- shape, types, bounds.

    Deliberately NOT the game's rules. board.validate() owns those, the editor
    runs it in the browser before it ever calls this, and a second half-copy of
    it here would be the copy that goes stale. This exists so that a malformed
    request produces a 400 instead of a level-data.js that will not parse.
    """
    problems = []
    if not isinstance(order, list) or not order:
        return ['order must be a non-empty array']
    if not isinstance(levels, dict) or not levels:
        return ['levels must be a non-empty object']

    for lid in order:
        if lid not in levels:
            problems.append('order names "%s", which has no level' % lid)
    for lid in levels:
        if not isinstance(lid, str) or not lid.isidentifier():
            problems.append('level key %r is not a valid identifier' % (lid,))
        elif lid not in order:
            problems.append('level "%s" is missing from order' % lid)

    for lid, lv in levels.items():
        where = 'level "%s"' % lid
        if not isinstance(lv, dict):
            problems.append('%s is not an object' % where)
            continue
        if lv.get('id') != lid:
            problems.append('%s has id %r, must match its key' % (where, lv.get('id')))
        if not isinstance(lv.get('name'), str) or not lv['name']:
            problems.append('%s needs a name' % where)

        rows = lv.get('heights')
        if not isinstance(rows, list) or not rows:
            problems.append('%s has no heights' % where)
            continue
        n = len(rows)
        for j, row in enumerate(rows):
            if not isinstance(row, list) or len(row) != n:
                problems.append('%s heights row %d is not %d wide (must be square)'
                                % (where, j, n))
                continue
            for i, v in enumerate(row):
                if isinstance(v, bool) or v not in TIERS:
                    problems.append('%s heights[%d][%d] is %r, must be one of %s'
                                    % (where, j, i, v, TIERS))

        def on_board(t):
            return (isinstance(t, list) and len(t) == 2
                    and all(isinstance(c, int) and not isinstance(c, bool)
                            and 0 <= c < n for c in t))

        def tiles(field, required=True):
            v = lv.get(field)
            if v is None and not required:
                return
            if not isinstance(v, list):
                problems.append('%s %s must be an array' % (where, field))
                return
            for t in v:
                if not on_board(t):
                    problems.append('%s %s has %r, want an on-board [i, j]'
                                    % (where, field, t))

        tiles('houses')
        tiles('shoreFallback')
        tiles('reserved', required=False)

        if not on_board(lv.get('heroSpawn')):
            problems.append('%s heroSpawn %r is not an on-board tile'
                            % (where, lv.get('heroSpawn')))

        ramps = lv.get('ramps')
        if not isinstance(ramps, list):
            problems.append('%s ramps must be an array' % where)
        else:
            for r in ramps:
                if not (isinstance(r, list) and len(r) == 2 and all(on_board(e) for e in r)):
                    problems.append('%s ramp %r is not [[lowI,lowJ],[highI,highJ]] on-board'
                                    % (where, r))

        intro = lv.get('intro')
        if intro is not None:
            if not isinstance(intro, dict) or 'from' not in intro or 'land' not in intro:
                problems.append('%s intro needs both from and land' % where)
            else:
                for f in ('from', 'land'):
                    v = intro[f]
                    if not (isinstance(v, list) and len(v) == 2
                            and all(isinstance(c, (int, float)) and not isinstance(c, bool)
                                    for c in v)):
                        problems.append('%s intro.%s %r is not a coordinate pair'
                                        % (where, f, v))

        if lv.get('notes') is not None and not isinstance(lv['notes'], str):
            problems.append('%s notes must be a string' % where)

    return problems


def write_atomic(path, text):
    """Temp file in the same directory, fsync, then replace. Old copy to .bak."""
    tmp = path + '.tmp'
    with io.open(tmp, 'w', newline='\r\n', encoding='utf-8') as fh:
        fh.write(text)
        fh.flush()
        os.fsync(fh.fileno())
    if os.path.exists(path):
        bak = path + '.bak'
        if os.path.exists(bak):
            os.remove(bak)
        os.replace(path, bak)
    os.replace(tmp, path)


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass            # the dev overlay is the log that matters

    # ---- saving ----

    def _json(self, code, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _same_origin(self):
        origin = self.headers.get('Origin')
        if origin is None:
            return True                 # curl and friends; not a browser CSRF
        host = self.headers.get('Host', '')
        return origin in ('http://' + host, 'https://' + host)

    def do_GET(self):
        # A health check, so the editor can find out at LOAD time whether saving
        # will work rather than at save time. The project is also servable by any
        # plain static file server -- the game itself needs nothing else -- and
        # from inside the page those are indistinguishable until you try to POST
        # and get a 404 back, having already done an hour of work.
        if self.path.split('?')[0] == '/api/save-levels':
            self._json(200, {'ok': True, 'endpoint': 'save-levels',
                             'path': LEVEL_DATA_PATH})
            return
        super().do_GET()

    def do_POST(self):
        if self.path.split('?')[0] != '/api/save-levels':
            self._json(404, {'error': 'no such endpoint'})
            return
        if not self._same_origin():
            self._json(403, {'error': 'cross-origin save refused'})
            return
        ctype = (self.headers.get('Content-Type') or '').split(';')[0].strip()
        if ctype != 'application/json':
            self._json(415, {'error': 'send application/json'})
            return

        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            self._json(400, {'error': 'bad Content-Length'})
            return
        if length <= 0 or length > MAX_BODY:
            self._json(413, {'error': 'body must be 1..%d bytes' % MAX_BODY})
            return

        try:
            payload = json.loads(self.rfile.read(length).decode('utf-8'))
            levels, order = payload['levels'], payload['order']
        except Exception as exc:
            self._json(400, {'error': 'unreadable body: %s' % exc})
            return

        problems = check_shape(levels, order)
        if problems:
            self._json(400, {'error': 'level data rejected', 'problems': problems})
            return

        try:
            text = serialize(levels, order)
            write_atomic(LEVEL_DATA_PATH, text)
        except Exception as exc:
            self._json(500, {'error': 'write failed: %s' % exc})
            return

        print('saved %d level(s) -> %s' % (len(order), LEVEL_DATA_PATH))
        self._json(200, {'ok': True, 'path': LEVEL_DATA_PATH,
                         'bytes': len(text), 'levels': list(order)})


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8124
    print('hero-td dev server on http://localhost:%d' % port)
    print('  POST /api/save-levels  ->  %s' % LEVEL_DATA_PATH)
    ThreadingHTTPServer(('127.0.0.1', port), NoCacheHandler).serve_forever()
