;; Reads stdin as [u32 table length][review table][JSON input], where each review table record is
;; [u32 ID length][ID bytes][f64 pull request number], calls the library export, and writes the
;; returned string to stdout. It runs inside the library's memory, which WASI reads through the
;; `memory` export.
(module
  (import "wasi_snapshot_preview1" "fd_read" (func $fd_read (param i32 i32 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "fd_write" (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (import "lib" "memory" (memory 0))
  (import "lib" "review_links_init" (func $init))
  (import "lib" "scriptc_alloc" (func $alloc (param i32) (result i32)))
  (import "lib" "review_links_derive" (func $derive (param i32 i32 i32 i32)))
  (import "scriptc" "callbacks" (table 1 funcref))
  (export "memory" (memory 0))
  (global $tableStart (mut i32) (i32.const 0))
  (global $tableEnd (mut i32) (i32.const 0))
  (elem declare func $lookup)

  (func $lookup (param $key i32) (param $keyLength i32) (result f64)
    (local $record i32)
    (local $idLength i32)
    (local.set $record (global.get $tableStart))
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (local.get $record) (global.get $tableEnd)))
        (local.set $idLength (i32.load align=1 (local.get $record)))
        (if (i32.eq (local.get $idLength) (local.get $keyLength))
          (then
            (if (call $equal (i32.add (local.get $record) (i32.const 4)) (local.get $key) (local.get $keyLength))
              (then (return (f64.load align=1 (i32.add (local.get $record) (i32.add (i32.const 4) (local.get $idLength)))))))))
        (local.set $record (i32.add (local.get $record) (i32.add (i32.const 12) (local.get $idLength))))
        (br $next)))
    (f64.const -1))

  (func $equal (param $left i32) (param $right i32) (param $length i32) (result i32)
    (local $index i32)
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (local.get $index) (local.get $length)))
        (if (i32.ne (i32.load8_u (i32.add (local.get $left) (local.get $index)))
                    (i32.load8_u (i32.add (local.get $right) (local.get $index))))
          (then (return (i32.const 0))))
        (local.set $index (i32.add (local.get $index) (i32.const 1)))
        (br $next)))
    (i32.const 1))

  (func $writeAll (param $pointer i32) (param $length i32) (param $scratch i32)
    (block $done
      (loop $next
        (br_if $done (i32.eqz (local.get $length)))
        (i32.store (local.get $scratch) (local.get $pointer))
        (i32.store offset=4 (local.get $scratch) (local.get $length))
        (if (call $fd_write (i32.const 1) (local.get $scratch) (i32.const 1) (i32.add (local.get $scratch) (i32.const 8)))
          (then unreachable))
        (local.set $pointer (i32.add (local.get $pointer) (i32.load offset=8 (local.get $scratch))))
        (local.set $length (i32.sub (local.get $length) (i32.load offset=8 (local.get $scratch))))
        (br $next))))

  (func (export "_start")
    (local $capacity i32)
    (local $buffer i32)
    (local $scratch i32)
    (local $total i32)
    (local $read i32)
    (local $tableLength i32)
    (local $input i32)
    (table.set 0 (i32.const 0) (ref.func $lookup))
    (call $init)
    (local.set $capacity (i32.const 16777216))
    (local.set $buffer (call $alloc (local.get $capacity)))
    (local.set $scratch (call $alloc (i32.const 16)))
    (if (i32.or (i32.eqz (local.get $buffer)) (i32.eqz (local.get $scratch))) (then unreachable))
    (block $done
      (loop $next
        (if (i32.ge_u (local.get $total) (local.get $capacity)) (then unreachable))
        (i32.store (local.get $scratch) (i32.add (local.get $buffer) (local.get $total)))
        (i32.store offset=4 (local.get $scratch) (i32.sub (local.get $capacity) (local.get $total)))
        (if (call $fd_read (i32.const 0) (local.get $scratch) (i32.const 1) (i32.add (local.get $scratch) (i32.const 8)))
          (then unreachable))
        (local.set $read (i32.load offset=8 (local.get $scratch)))
        (br_if $done (i32.eqz (local.get $read)))
        (local.set $total (i32.add (local.get $total) (local.get $read)))
        (br $next)))
    (local.set $tableLength (i32.load align=1 (local.get $buffer)))
    (global.set $tableStart (i32.add (local.get $buffer) (i32.const 4)))
    (global.set $tableEnd (i32.add (global.get $tableStart) (local.get $tableLength)))
    (local.set $input (global.get $tableEnd))
    (call $derive
      (local.get $input)
      (i32.sub (i32.add (local.get $buffer) (local.get $total)) (local.get $input))
      (local.get $scratch)
      (i32.add (local.get $scratch) (i32.const 4)))
    (call $writeAll
      (i32.load (local.get $scratch))
      (i32.load offset=4 (local.get $scratch))
      (local.get $scratch))))
