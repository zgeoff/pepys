;; The guest imports this memory in place of its own, so the clock can write time 0 into it.
(module
  (memory (export "memory") 1024)
  (func (export "clock_time_get") (param i32 i64 i32) (result i32)
    (i64.store (local.get 2) (i64.const 0))
    (i32.const 0))
  (func (export "random_get") (param i32 i32) (result i32) (i32.const 52)))
