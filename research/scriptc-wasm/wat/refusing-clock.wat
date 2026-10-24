;; Every call returns WASI errno 52 (ENOSYS), so the guest runs on but never learns the time.
(module
  (func (export "clock_time_get") (param i32 i64 i32) (result i32) (i32.const 52))
  (func (export "random_get") (param i32 i32) (result i32) (i32.const 52)))
