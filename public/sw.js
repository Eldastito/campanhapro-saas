/**
 * Service worker MÍNIMO — habilita o "Instalar app" (PWA) sem cache agressivo.
 *
 * De propósito NÃO intercepta requisições (sem respondWith): a rede funciona
 * normal, então nunca serve versão velha depois de um deploy. A simples
 * presença de um handler de 'fetch' já satisfaz o critério de instalabilidade.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* passthrough: deixa a rede resolver */ });
