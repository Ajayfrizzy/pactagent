#![no_std]
#![no_main]

use alloc::vec::Vec;
use ckb_std::{
    ckb_constants::Source,
    ckb_types::prelude::*,
    default_alloc,
    entry,
    error::SysError,
    high_level::{
        load_cell_capacity,
        load_cell_data,
        load_cell_lock_hash,
        load_input_since,
        load_script,
    },
};
use pact_escrow_lock::{
    evaluate_spend,
    parse_party_hashes,
    parse_terms,
    Error,
    OutputCell,
    TxState,
};

default_alloc!();
entry!(program_entry);

fn program_entry() -> i8 {
    match validate() {
        Ok(()) => 0,
        Err(err) => err as i8,
    }
}

fn validate() -> Result<(), Error> {
    let script = load_script().map_err(map_sys_error)?;
    let args: Vec<u8> = script.args().unpack();
    let parties = parse_party_hashes(&args)?;

    let data = load_cell_data(0, Source::GroupInput).map_err(map_sys_error)?;
    let terms = parse_terms(&data)?;

    match load_cell_capacity(1, Source::GroupInput) {
        Ok(_) => return Err(Error::MultipleEscrowInputs),
        Err(SysError::IndexOutOfBound) => {}
        Err(err) => return Err(map_sys_error(err)),
    }

    let input_capacity = load_cell_capacity(0, Source::GroupInput).map_err(map_sys_error)?;
    let input_since = load_input_since(0, Source::GroupInput).map_err(map_sys_error)?;
    let signer_lock_hashes = collect_lock_hashes(Source::Input)?;
    let outputs = collect_outputs()?;

    let tx = TxState {
        input_capacity,
        input_since,
        signer_lock_hashes: &signer_lock_hashes,
        outputs: &outputs,
    };

    evaluate_spend(&parties, &terms, &tx)?;
    Ok(())
}

fn collect_outputs() -> Result<Vec<OutputCell>, Error> {
    let mut outputs = Vec::new();
    let mut index = 0;

    loop {
        match (
            load_cell_lock_hash(index, Source::Output),
            load_cell_capacity(index, Source::Output),
        ) {
            (Ok(lock_hash), Ok(capacity)) => {
                outputs.push(OutputCell {
                    lock_hash,
                    capacity,
                });
                index += 1;
            }
            (Err(SysError::IndexOutOfBound), _) | (_, Err(SysError::IndexOutOfBound)) => break,
            (Err(err), _) => return Err(map_sys_error(err)),
            (_, Err(err)) => return Err(map_sys_error(err)),
        }
    }

    Ok(outputs)
}

fn collect_lock_hashes(source: Source) -> Result<Vec<[u8; 32]>, Error> {
    let mut hashes = Vec::new();
    let mut index = 0;

    loop {
        match load_cell_lock_hash(index, source) {
            Ok(hash) => {
                hashes.push(hash);
                index += 1;
            }
            Err(SysError::IndexOutOfBound) => break,
            Err(err) => return Err(map_sys_error(err)),
        }
    }

    Ok(hashes)
}

fn map_sys_error(_: SysError) -> Error {
    Error::MissingExpectedOutput
}
