;; Loaded as the `scriptc` namespace. The driver fills the table at start, because the lookup reads
;; the library's memory and this module is instantiated before the library exists.
(module
  (type $lookup (func (param i32 i32) (result f64)))
  (table (export "callbacks") 1 funcref)
  (func (export "readPullRequestNumber") (param i32 i32) (result f64)
    (call_indirect (type $lookup) (local.get 0) (local.get 1) (i32.const 0)))
  (func (export "panic") (param i32 i32) unreachable))
