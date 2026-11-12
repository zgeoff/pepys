import { expect, test } from 'bun:test';
import { parsePasskeyPage } from './parse-passkey-page.ts';

test('it reads the request options of a sign-in page', () => {
  const page = parsePasskeyPage(
    '<p>x</p><script type="application/json" id="pepys-passkey">{"mode":"get","options":{"challenge":"Y2g","rpId":"pepys.example","timeout":1}}</script>',
  );

  expect(page).toStrictEqual({ mode: 'get', options: { challenge: 'Y2g', rpId: 'pepys.example' } });
});

test('it reads the creation options of an enrollment page', () => {
  const page = parsePasskeyPage(
    '<script type="application/json" id="pepys-passkey">{"mode":"create","options":{"challenge":"Y2g","rp":{"id":"pepys.example","name":"pepys"},"user":{"id":"b3du"}}}</script>',
  );

  expect(page).toStrictEqual({
    mode: 'create',
    options: { challenge: 'Y2g', rp: { id: 'pepys.example' }, user: { id: 'b3du' } },
  });
});

test('it throws on a page with no passkey ceremony', () => {
  expect(() => parsePasskeyPage('<p>no passkey</p>')).toThrow('holds no passkey ceremony');
});

test('it throws on a ceremony of neither kind', () => {
  expect(() =>
    parsePasskeyPage(
      '<script type="application/json" id="pepys-passkey">{"mode":"other","options":{}}</script>',
    ),
  ).toThrow();
});
