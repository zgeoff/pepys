export interface WITExport {
  name: string;
  symbol: string;
}

export interface WITImport {
  callback: string;
  name: string;
}

export interface WITBridge {
  interfacePrefix: string;
  imports: WITImport[];
  exportInterface: string;
  exports: WITExport[];
}

// scriptc's reactor ABI matches the canonical ABI for imports that take strings, bytes and
// numbers, so imports only need WIT names. A string result differs: scriptc writes two out-slots,
// while the canonical ABI returns a pointer to them, so each export gets a bridge function.
export function buildComponentModule(text: string, bridge: WITBridge): string {
  const renamed = bridge.imports.reduce(
    (current, entry) =>
      current.replace(
        `(import "scriptc" "${entry.callback}"`,
        `(import "${bridge.interfacePrefix}" "${entry.name}"`,
      ),
    text,
  );

  const alloc = getExportedFunction(renamed, 'scriptc_alloc');
  const free = getExportedFunction(renamed, 'scriptc_free');
  const init = getExportedFunction(renamed, 'review_links_init');

  const exports = bridge.exports.map(
    (entry) => `
  (func (export "${bridge.exportInterface}#${entry.name}") (param i32 i32) (result i32)
    (local $slots i32)
    (if (i32.eqz (global.get $pepysReady))
      (then (call ${init}) (global.set $pepysReady (i32.const 1))))
    (local.set $slots (call ${alloc} (i32.const 8)))
    (call ${getExportedFunction(renamed, entry.symbol)} (local.get 0) (local.get 1) (local.get $slots)
      (i32.add (local.get $slots) (i32.const 4)))
    (local.get $slots))`,
  );

  const realloc = `
  (func (export "cabi_realloc") (param i32 i32 i32 i32) (result i32)
    (local $next i32)
    (local.set $next (call ${alloc} (local.get 3)))
    (if (local.get 0)
      (then
        (memory.copy (local.get $next) (local.get 0)
          (select (local.get 1) (local.get 3) (i32.lt_u (local.get 1) (local.get 3))))
        (call ${free} (local.get 0))))
    (local.get $next))`;

  const end = renamed.trimEnd().lastIndexOf(')');

  return `${renamed.slice(0, end)}
  (global $pepysReady (mut i32) (i32.const 0))${exports.join('')}${realloc})\n`;
}

function getExportedFunction(text: string, name: string): string {
  const match = new RegExp(`\\(export "${name}" \\(func (?<index>\\d+)\\)\\)`, 'u').exec(text);

  const index = match?.groups?.['index'];

  if (index === undefined) {
    throw new Error(`the module text exports no function ${name}`);
  }

  return index;
}
