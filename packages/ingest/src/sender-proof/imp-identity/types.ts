// The imp that a verified identity token names. The shape of the verifier's answer in the
// `@impz/client/identity` entry of impz.
export interface VerifiedImp {
  // the token's `iss`: the impd that signed it
  readonly issuer: string;

  // the token's `sub`: the imp's ID, unique on one impd only
  readonly id: string;

  // the imp's name, for logs; a name is free again after a destroy, so it is no key
  readonly name: string;
}

// What the deployment trusts, read from its environment at start: the trust documents of each
// `issuersEnv` and the audience of each `audienceEnv` that its paths name. A name with no entry
// refuses every delivery on its paths.
export interface ImpIdentityTrust<Document> {
  readonly issuers: ReadonlyMap<string, readonly Document[]>;
  readonly audiences: ReadonlyMap<string, string>;
}

export interface VerifyOptions<Document> {
  readonly issuers: readonly Document[];
  readonly audience: string;
  readonly nowSeconds: number;
}

// The verifier of `@impz/client/identity`, which owns the token format and the trust document
// format. `Document` stays opaque to ingest.
export interface ImpIdentityVerifier<Document> {
  // Answers null for a token to refuse: a bad signature, an issuer with no trust document, another
  // audience, or a token out of its time. Throws on an empty or doubled list of documents.
  verify: (header: string | null, options: VerifyOptions<Document>) => Promise<VerifiedImp | null>;

  // Parses the documents a deployment pinned. Throws on an invalid document, on none, and on two
  // with one issuer.
  loadIssuers: (documents: readonly unknown[]) => Document[];
}
