#![cfg_attr(not(test), no_std)]

extern crate alloc;

pub const HASH_LEN: usize = 32;
pub const PARTY_HASHES_LEN: usize = HASH_LEN * 3;
pub const MAGIC: [u8; 8] = *b"PACTESC1";
pub const VERSION: u8 = 1;
pub const ESCROW_DATA_LEN: usize = 88;

#[repr(i8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Error {
    InvalidArgsLength = 5,
    InvalidCellDataLength = 6,
    InvalidMagic = 7,
    UnsupportedVersion = 8,
    MissingRequiredSigner = 9,
    MissingExpectedOutput = 10,
    InvalidTimeoutSince = 11,
    AmbiguousSettlementOutputs = 12,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PartyHashes {
    pub client: [u8; HASH_LEN],
    pub worker: [u8; HASH_LEN],
    pub arbitrator: [u8; HASH_LEN],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EscrowTerms {
    pub version: u8,
    pub milestone_index: u32,
    pub refund_timeout_since: u64,
    pub agreement_digest: [u8; HASH_LEN],
    pub milestone_digest: [u8; HASH_LEN],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OutputCell {
    pub lock_hash: [u8; HASH_LEN],
    pub capacity: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TxState<'a> {
    pub input_capacity: u64,
    pub input_since: u64,
    pub signer_lock_hashes: &'a [[u8; HASH_LEN]],
    pub outputs: &'a [OutputCell],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ResolutionPath {
    ClientPayout,
    ArbitratorPayout,
    ArbitratorRefund,
    TimeoutRefund,
}

pub fn parse_party_hashes(args: &[u8]) -> Result<PartyHashes, Error> {
    if args.len() != PARTY_HASHES_LEN {
        return Err(Error::InvalidArgsLength);
    }

    Ok(PartyHashes {
        client: args[0..HASH_LEN].try_into().map_err(|_| Error::InvalidArgsLength)?,
        worker: args[HASH_LEN..HASH_LEN * 2]
            .try_into()
            .map_err(|_| Error::InvalidArgsLength)?,
        arbitrator: args[HASH_LEN * 2..HASH_LEN * 3]
            .try_into()
            .map_err(|_| Error::InvalidArgsLength)?,
    })
}

pub fn parse_terms(data: &[u8]) -> Result<EscrowTerms, Error> {
    if data.len() != ESCROW_DATA_LEN {
        return Err(Error::InvalidCellDataLength);
    }

    if data[0..8] != MAGIC {
        return Err(Error::InvalidMagic);
    }

    if data[8] != VERSION {
        return Err(Error::UnsupportedVersion);
    }

    let milestone_index = u32::from_le_bytes(data[12..16].try_into().map_err(|_| Error::InvalidCellDataLength)?);
    let refund_timeout_since = u64::from_le_bytes(data[16..24].try_into().map_err(|_| Error::InvalidCellDataLength)?);
    let agreement_digest = data[24..56].try_into().map_err(|_| Error::InvalidCellDataLength)?;
    let milestone_digest = data[56..88].try_into().map_err(|_| Error::InvalidCellDataLength)?;

    Ok(EscrowTerms {
        version: data[8],
        milestone_index,
        refund_timeout_since,
        agreement_digest,
        milestone_digest,
    })
}

pub fn serialize_terms(terms: &EscrowTerms) -> [u8; ESCROW_DATA_LEN] {
    let mut bytes = [0u8; ESCROW_DATA_LEN];
    bytes[0..8].copy_from_slice(&MAGIC);
    bytes[8] = terms.version;
    bytes[12..16].copy_from_slice(&terms.milestone_index.to_le_bytes());
    bytes[16..24].copy_from_slice(&terms.refund_timeout_since.to_le_bytes());
    bytes[24..56].copy_from_slice(&terms.agreement_digest);
    bytes[56..88].copy_from_slice(&terms.milestone_digest);
    bytes
}

pub fn evaluate_spend(
    parties: &PartyHashes,
    terms: &EscrowTerms,
    tx: &TxState<'_>,
) -> Result<ResolutionPath, Error> {
    let client_auth = has_signer(tx.signer_lock_hashes, &parties.client);
    let arbitrator_auth = has_signer(tx.signer_lock_hashes, &parties.arbitrator);
    let worker_output = has_exact_output(tx.outputs, &parties.worker, tx.input_capacity)?;
    let client_output = has_exact_output(tx.outputs, &parties.client, tx.input_capacity)?;

    if worker_output && client_auth {
        return Ok(ResolutionPath::ClientPayout);
    }

    if worker_output && arbitrator_auth {
        return Ok(ResolutionPath::ArbitratorPayout);
    }

    if client_output && arbitrator_auth {
        return Ok(ResolutionPath::ArbitratorRefund);
    }

    if client_output && timeout_refund_reached(tx.input_since, terms.refund_timeout_since) {
        return Ok(ResolutionPath::TimeoutRefund);
    }

    if !client_auth && !arbitrator_auth {
        return Err(Error::MissingRequiredSigner);
    }

    Err(Error::MissingExpectedOutput)
}

fn has_signer(signers: &[[u8; HASH_LEN]], target: &[u8; HASH_LEN]) -> bool {
    signers.iter().any(|hash| hash == target)
}

fn has_exact_output(
    outputs: &[OutputCell],
    target_lock_hash: &[u8; HASH_LEN],
    expected_capacity: u64,
) -> Result<bool, Error> {
    let matches = outputs
        .iter()
        .filter(|output| &output.lock_hash == target_lock_hash && output.capacity == expected_capacity)
        .count();

    if matches > 1 {
        return Err(Error::AmbiguousSettlementOutputs);
    }

    Ok(matches == 1)
}

fn timeout_refund_reached(current_since: u64, required_since: u64) -> bool {
    current_since >> 56 == 0 && current_since >= required_since
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hash(byte: u8) -> [u8; HASH_LEN] {
        [byte; HASH_LEN]
    }

    fn sample_terms() -> EscrowTerms {
        EscrowTerms {
            version: VERSION,
            milestone_index: 1,
            refund_timeout_since: 123,
            agreement_digest: hash(9),
            milestone_digest: hash(7),
        }
    }

    fn sample_parties() -> PartyHashes {
        PartyHashes {
            client: hash(1),
            worker: hash(2),
            arbitrator: hash(3),
        }
    }

    #[test]
    fn parses_party_hashes() {
        let mut args = Vec::new();
        args.extend_from_slice(&hash(1));
        args.extend_from_slice(&hash(2));
        args.extend_from_slice(&hash(3));

        let parsed = parse_party_hashes(&args).unwrap();
        assert_eq!(parsed.client, hash(1));
        assert_eq!(parsed.worker, hash(2));
        assert_eq!(parsed.arbitrator, hash(3));
    }

    #[test]
    fn serializes_and_parses_terms() {
        let terms = sample_terms();
        let bytes = serialize_terms(&terms);
        let reparsed = parse_terms(&bytes).unwrap();
        assert_eq!(reparsed, terms);
    }

    #[test]
    fn allows_client_payout() {
        let parties = sample_parties();
        let outputs = [OutputCell {
            lock_hash: parties.worker,
            capacity: 100,
        }];
        let signers = [parties.client];
        let tx = TxState {
            input_capacity: 100,
            input_since: 0,
            signer_lock_hashes: &signers,
            outputs: &outputs,
        };

        let resolution = evaluate_spend(&parties, &sample_terms(), &tx).unwrap();
        assert_eq!(resolution, ResolutionPath::ClientPayout);
    }

    #[test]
    fn allows_arbitrator_refund() {
        let parties = sample_parties();
        let outputs = [OutputCell {
            lock_hash: parties.client,
            capacity: 100,
        }];
        let signers = [parties.arbitrator];
        let tx = TxState {
            input_capacity: 100,
            input_since: 0,
            signer_lock_hashes: &signers,
            outputs: &outputs,
        };

        let resolution = evaluate_spend(&parties, &sample_terms(), &tx).unwrap();
        assert_eq!(resolution, ResolutionPath::ArbitratorRefund);
    }

    #[test]
    fn allows_timeout_refund() {
        let parties = sample_parties();
        let outputs = [OutputCell {
            lock_hash: parties.client,
            capacity: 100,
        }];
        let signers: [[u8; HASH_LEN]; 0] = [];
        let tx = TxState {
            input_capacity: 100,
            input_since: 123,
            signer_lock_hashes: &signers,
            outputs: &outputs,
        };

        let resolution = evaluate_spend(&parties, &sample_terms(), &tx).unwrap();
        assert_eq!(resolution, ResolutionPath::TimeoutRefund);
    }

    #[test]
    fn rejects_wrong_destination() {
        let parties = sample_parties();
        let outputs = [OutputCell {
            lock_hash: hash(8),
            capacity: 100,
        }];
        let signers = [parties.client, parties.worker];
        let tx = TxState {
            input_capacity: 100,
            input_since: 0,
            signer_lock_hashes: &signers,
            outputs: &outputs,
        };

        let err = evaluate_spend(&parties, &sample_terms(), &tx).unwrap_err();
        assert_eq!(err, Error::MissingExpectedOutput);
    }
}
