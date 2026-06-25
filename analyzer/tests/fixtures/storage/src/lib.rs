//! Fixture mirroring ethlambda's typed KV store: a `Table` enum whose variants
//! are documented `<desc>: <Key> -> <Value>`, plus the value structs. Asserted
//! in tests/analyze.rs (storage-table detection + value-type resolution).

/// 32-byte hash, used as the block-root key for the content-addressed tables.
pub struct H256([u8; 32]);

/// Storage tables (column families). Variants documented `<Key> -> <Value>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Table {
    /// Block header storage: H256 -> BlockHeader
    BlockHeaders,
    /// Block body storage: H256 -> BlockBody
    BlockBodies,
    /// State storage: H256 -> State
    States,
    /// Metadata: string keys -> various scalar values
    Metadata,
    /// Live chain index: (slot || root) -> parent_root
    ///
    /// Fast lookup for fork choice without deserializing full blocks.
    LiveChain,
}

/// Not a storage table — an ordinary enum with a single arrow doc. Must NOT be
/// detected (only one parsing variant; the ≥2 rule excludes it).
pub enum Direction {
    /// maps left -> right
    Forward,
    Backward,
}

pub struct BlockHeader {
    pub slot: u64,
    /// Self-referential FK: the parent block's root (same key type as the
    /// H256-keyed block tables).
    pub parent_root: H256,
    pub state_root: H256,
}

pub struct BlockBody {
    pub attestations: Vec<u8>,
}

pub struct State {
    pub slot: u64,
    pub latest_block_header: BlockHeader,
}
