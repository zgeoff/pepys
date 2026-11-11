//! The envelope check an append runs. It and the TypeScript check run the same cases, in
//! `packages/kit/src/fact-envelope-cases.json`.

use serde_json::{Map, Value};

use crate::entity_ids::{is_name_part, kind_of};

const FIELDS: [&str; 9] = [
    "id", "type", "v", "api", "entity", "actor", "at", "cursor", "payload",
];

/// Whether `body` is a fact envelope: a JSON object with the envelope's fields and no others.
pub fn is_fact_envelope(body: &str) -> bool {
    let Ok(Value::Object(fields)) = serde_json::from_str::<Value>(body) else {
        return false;
    };

    fields.keys().all(|key| FIELDS.contains(&key.as_str()))
        && text_field(&fields, "id").is_some_and(is_fact_id)
        && text_field(&fields, "type").is_some_and(|text| !text.is_empty())
        && fields.get("v").and_then(Value::as_f64) == Some(1.0)
        && text_field(&fields, "api").is_some_and(|text| !text.is_empty())
        && text_field(&fields, "entity").is_some_and(|text| kind_of(text).is_some())
        && fields
            .get("actor")
            .is_none_or(|actor| actor.as_str().is_some_and(|text| kind_of(text).is_some()))
        && text_field(&fields, "at").is_some_and(is_utc_datetime)
        && fields.get("cursor").is_none_or(Value::is_string)
        && fields.contains_key("payload")
}

fn text_field<'a>(fields: &'a Map<String, Value>, name: &str) -> Option<&'a str> {
    fields.get(name).and_then(Value::as_str)
}

fn is_fact_id(text: &str) -> bool {
    if let Some(rest) = text
        .strip_prefix("webhook:")
        .or_else(|| text.strip_prefix("event:"))
    {
        return rest
            .split_once(':')
            .is_some_and(|(source, id)| is_name_part(source) && is_one_line(id));
    }

    ["observation:", "enrichment:", "manual:"]
        .iter()
        .any(|prefix| {
            text.strip_prefix(prefix).is_some_and(|hash| {
                hash.len() == 64
                    && hash
                        .bytes()
                        .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
            })
        })
}

/// Not empty, and free of the characters that end a line for `.` in a JavaScript pattern.
fn is_one_line(text: &str) -> bool {
    !text.is_empty() && !text.contains(['\n', '\r', '\u{2028}', '\u{2029}'])
}

/// `YYYY-MM-DDTHH:MM:SS` with optional fractional seconds and a `Z`, on a day the calendar has.
fn is_utc_datetime(text: &str) -> bool {
    let Some(stamp) = text.strip_suffix('Z') else {
        return false;
    };
    let (whole, fraction) = stamp.split_once('.').unwrap_or((stamp, "0"));
    let bytes = whole.as_bytes();
    let is_shaped = bytes.len() == 19
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            4 | 7 => *byte == b'-',
            10 => *byte == b'T',
            13 | 16 => *byte == b':',
            _ => byte.is_ascii_digit(),
        });

    if !is_shaped || fraction.is_empty() || !fraction.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }

    let number = |range: std::ops::Range<usize>| whole[range].parse::<u32>().unwrap_or(u32::MAX);
    let (year, month, day) = (number(0..4), number(5..7), number(8..10));

    (1..=days_in_month(year, month)).contains(&day)
        && number(11..13) < 24
        && number(14..16) < 60
        && number(17..19) < 60
}

fn days_in_month(year: u32, month: u32) -> u32 {
    let is_leap = (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400);

    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap => 29,
        2 => 28,
        _ => 0,
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    const CASES: &str = include_str!("../../../../packages/kit/src/fact-envelope-cases.json");

    #[test]
    fn it_gives_each_shared_envelope_case_its_verdict() {
        let cases: Value = serde_json::from_str(CASES).expect("the cases");

        let wrong: Vec<&str> = cases["cases"]
            .as_array()
            .expect("a list of cases")
            .iter()
            .filter(|case| {
                is_fact_envelope(&case["envelope"].to_string())
                    != case["isValid"].as_bool().expect("a verdict")
            })
            .map(|case| case["title"].as_str().expect("a title"))
            .collect();

        assert_eq!(wrong, Vec::<&str>::new());
    }
}
