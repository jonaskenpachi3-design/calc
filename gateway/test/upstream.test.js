import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { CacheTtl, chamar } from '../src/upstream.js';

test('CacheTtl descarta o menos usado recentemente', () => {
  const c = new CacheTtl(60000, 2);
  c.set('a', 1); c.set('b', 2);
  assert.equal(c.get('a'), 1); // 'a' passa a ser o mais recente
  c.set('c', 3);               // sai 'b'
  assert.equal(c.get('b'), undefined);
  assert.equal(c.get('a'), 1);
  assert.equal(c.get('c'), 3);
});

test('CacheTtl corrige parâmetros inválidos', () => {
  const c = new CacheTtl(-5, 0);
  c.set('x', 1);
  assert.equal(c.get('x'), 1);
});

test('chamar recusa resposta maior que o teto', async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/plain' }); r.end('x'.repeat(5000)); }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const url = `http://127.0.0.1:${srv.address().port}/`;
  const grande = await chamar(url, { maxBytes: 1000 });
  const ok = await chamar(url, { maxBytes: 10000 });
  srv.close();
  assert.equal(grande.ok, false);
  assert.equal(grande.motivo, 'resposta_grande_demais');
  assert.equal(ok.ok, true);
});
