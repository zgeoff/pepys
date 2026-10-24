use std::collections::HashMap;

use serde_json::Value;

use crate::ReadShape;

/// One consumer input split the way the host would hold it: the fact goes to the consumer, and the
/// review rows sit in the host's store.
pub struct Split {
    pub input: String,
    pub rows: HashMap<String, Vec<u8>>,
}

/// Moves the input's reviews into a row store. In the prefetch shape the host then puts back the
/// rows for every review a finding names, before the call.
pub fn split(input: &str, reads: ReadShape) -> Split {
    let Ok(Value::Object(mut object)) = serde_json::from_str::<Value>(input) else {
        return Split {
            input: input.to_owned(),
            rows: HashMap::new(),
        };
    };
    let Some(Value::Array(reviews)) = object.remove("reviews") else {
        return Split {
            input: input.to_owned(),
            rows: HashMap::new(),
        };
    };

    let rows: HashMap<String, Vec<u8>> = reviews
        .iter()
        .filter_map(|review| {
            let id = review.get("id")?.as_str()?;
            Some((id.to_owned(), review.to_string().into_bytes()))
        })
        .collect();

    let reviews = match reads {
        ReadShape::Prefetch => prefetch(&object, &rows),
        ReadShape::Reads => Vec::new(),
    };
    object.insert("reviews".to_owned(), Value::Array(reviews));

    Split {
        input: Value::Object(object).to_string(),
        rows,
    }
}

fn prefetch(
    object: &serde_json::Map<String, Value>,
    rows: &HashMap<String, Vec<u8>>,
) -> Vec<Value> {
    let mut seen: Vec<String> = Vec::new();
    let findings = object.get("findings").and_then(Value::as_array);

    for finding in findings.into_iter().flatten() {
        if let Some(id) = finding.get("reviewID").and_then(Value::as_str)
            && !seen.iter().any(|known| known == id)
            && rows.contains_key(id)
        {
            seen.push(id.to_owned());
        }
    }

    seen.iter()
        .filter_map(|id| rows.get(id))
        .filter_map(|row| serde_json::from_slice::<Value>(row).ok())
        .collect()
}
