//! A link between two entities, as the wire carries it: flat, with the type as a field.

use serde::Deserialize;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Link {
    #[serde(rename = "type")]
    pub link_type: String,
    pub from: String,
    pub to: String,
    pub confidence: f64,
    pub evidence: String,
}

/// The ends of a link to remove.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LinkEnds {
    #[serde(rename = "type")]
    pub link_type: String,
    pub from: String,
    pub to: String,
}
