import { CellOutput, type CellOutputLike } from '@ckb-ccc/core';

export function calculateOccupiedCapacity(
  output: Omit<CellOutputLike, 'capacity'>,
  outputData = '0x',
) {
  return BigInt(CellOutput.from(output, outputData).capacity);
}
