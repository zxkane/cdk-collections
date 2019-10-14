import http.server
import socketserver
import io
import os
import socket

class Handler(http.server.SimpleHTTPRequestHandler):

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-type', 'text/html')
        self.end_headers()
        hostname = self.headers.get('Host')
        if (hostname == None):
            hostname = socket.gethostname()
        content = '''
        <html><head>
        <title>Welcome!</title>
        <style>
            body {{
                width: 35em;
                margin: 0 auto;
                font-family: Tahoma, Verdana, Arial, sans-serif;
            }}
        </style></head>
        <body>
        <h1>Hello!</h1>
        <p><em>Welcome to visit us from {}.</em></p>
        </body></html>
        '''.format(hostname)
        self.wfile.write(bytes(content, encoding='utf8'))

PORT = int(os.getenv('PORT')) if os.getenv('PORT') else 80
with socketserver.TCPServer(('', PORT), Handler) as httpd:
    print('Server listening on port %s...' %(PORT))
    httpd.serve_forever()