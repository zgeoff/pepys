# 0022: Consumers are core modules that read through host-written memory

Date: 2026-10-24

## Decision

Each consumer runs as a WASI preview 1 core module. Its input and its operations pass through the
module's exported memory, and a read is a scalar host import for the row's length followed by a host
import that writes the row into a buffer the consumer passes. The boundary glue on both sides is
generated from the consumer declarations.

## Rejected alternatives

| Option                                            | Why not                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| a component with a WIT world, reads by host write | the canonical ABI copies a buffer argument, so the host's write never reaches the consumer              |
| a component with a WIT world, rows prefetched     | needs every read key before the call, and a bridge, `cabi_realloc` and three wasm-tools steps per build |
| a core module with rows prefetched                | needs every read key before the call, which no consumer declaration states                              |

## Why

scriptc emits core modules, and its host imports return only numbers. The core module with host
writes is the one measured shape in which a consumer reads from the host during its call, which
scope consumers need for joins. Its glue is a fixed template per read and per export. It relies on
scriptc passing a byte buffer as a view of module memory, which scriptc does not promise, so the
host's boundary tests gate every scriptc upgrade. The
[host boundary spike](../../research/host-boundary/README.md) holds the measurements.
