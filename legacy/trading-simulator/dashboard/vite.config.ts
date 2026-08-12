import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import type { Plugin } from 'vite'

const ROOT = path.resolve(__dirname, '..')

/** Vite plugin: serve local JSON files and handle writes via POST */
function localFilesPlugin(): Plugin {
  return {
    name: 'local-files-api',
    configureServer(server) {
      // GET /api/files/:name — read a JSON file from project root
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/files/')) return next()
        const filename = decodeURIComponent(req.url.replace('/api/files/', '').split('?')[0])
        const allowed = ['journal.json', 'watchlist.json', 'pending_orders.json', 'news_data.json', 'lpi_history.json']
        if (!allowed.includes(filename)) {
          res.writeHead(404); res.end('Not found'); return
        }
        const filepath = path.join(ROOT, filename)

        if (req.method === 'GET') {
          try {
            const data = fs.readFileSync(filepath, 'utf-8')
            res.setHeader('Content-Type', 'application/json')
            res.end(data)
          } catch {
            res.setHeader('Content-Type', 'application/json')
            res.end('[]')
          }
          return
        }

        if (req.method === 'POST' || req.method === 'PUT') {
          let body = ''
          req.on('data', (chunk: Buffer) => { body += chunk.toString() })
          req.on('end', () => {
            try {
              const parsed = JSON.parse(body)
              fs.writeFileSync(filepath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8')
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true }))
            } catch (e) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: String(e) }))
            }
          })
          return
        }

        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), localFilesPlugin()],
  server: {
    proxy: {
      // Proxy Yahoo Finance requests to bypass CORS
      '/api/yahoo': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/yahoo/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
      },
      // Proxy Stockbit API requests (covers all endpoints: marketdetectors, orderbook, stream, news, etc.)
      '/api/stockbit': {
        target: 'https://exodus.stockbit.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/stockbit/, ''),
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, _req, _res) => {
            // Inject JWT token from local env if available
            if (process.env.STOCKBIT_JWT_TOKEN) {
              proxyReq.setHeader('authorization', `Bearer ${process.env.STOCKBIT_JWT_TOKEN}`);
            }
            proxyReq.setHeader('origin', 'https://stockbit.com');
            proxyReq.setHeader('referer', 'https://stockbit.com/');
            proxyReq.setHeader('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36');
          });
        },
      },
      // Proxy Tradersaham API for daily broker flow
      '/api/tradersaham': {
        target: 'https://api.tradersaham.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/tradersaham/, ''),
      },
    },
  },
})
