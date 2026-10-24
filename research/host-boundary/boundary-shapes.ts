export interface BoundaryShape {
  name: string;
  kind: 'core' | 'component';
  reads: 'prefetch' | 'reads';
  glue: string;
  generator: string;
  isGeneratorWritable: boolean;
}

// What each shape needs beside the consumer, and whether a generator could write it from a schema
// declaration. The runner observes the rest.
export const boundaryShapes: BoundaryShape[] = [
  {
    name: 'core module, rows prefetched into the input',
    kind: 'core',
    reads: 'prefetch',
    glue: 'alloc, copy the input in, read two out-slots',
    generator: 'yes, if the schema declares the read keys ahead of the call',
    isGeneratorWritable: true,
  },
  {
    name: 'core module, scalar read then host write into memory',
    kind: 'core',
    reads: 'reads',
    glue: 'two func_wrap host functions per read, plus the export call',
    generator: 'yes, one fixed template per declared read',
    isGeneratorWritable: true,
  },
  {
    name: 'component, rows prefetched into the input',
    kind: 'component',
    reads: 'prefetch',
    glue: 'a WAT bridge per export, cabi_realloc, wasm-tools embed and new; bindgen! on the host',
    generator: 'yes, the bridge is one template per export',
    isGeneratorWritable: true,
  },
  {
    name: 'component, scalar read then host write into memory',
    kind: 'component',
    reads: 'reads',
    glue: 'the same bridge; the read imports keep their scriptc signatures',
    generator: 'yes, but the shape cannot carry the row',
    isGeneratorWritable: true,
  },
];
