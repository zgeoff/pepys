export interface PublicKeyJWK {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

export interface Identity {
  issuer: string;
  id: string;

  // the RFC 7638 thumbprint of the public key
  kid: string;
  publicKey: PublicKeyJWK;
  privateKey: CryptoKey;
}
