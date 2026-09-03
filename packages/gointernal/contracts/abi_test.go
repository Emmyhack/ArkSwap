package contracts

import (
	"encoding/json"
	"math/big"
	"os"
	"path/filepath"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

// The embedded ABIs must stay identical to packages/abis, which is generated
// from the compiled contracts. If they drift, the Go apps would decode events
// with a different shape than the contracts actually emit.
func TestABIsMatchGeneratedPackage(t *testing.T) {
	for _, name := range []string{"ArkSwapFactory.json", "ArkSwapPair.json", "ERC20.json"} {
		mine, err := os.ReadFile(name)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		theirs, err := os.ReadFile(filepath.Join("..", "..", "abis", name))
		if err != nil {
			t.Fatalf("read packages/abis/%s: %v", name, err)
		}
		var a, b any
		if err := json.Unmarshal(mine, &a); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if err := json.Unmarshal(theirs, &b); err != nil {
			t.Fatalf("packages/abis/%s: %v", name, err)
		}
		x, _ := json.Marshal(a)
		y, _ := json.Marshal(b)
		if string(x) != string(y) {
			t.Fatalf("%s has drifted from packages/abis — re-run `pnpm abis:generate` and re-copy", name)
		}
	}
}

// Topic0 values must match the canonical Uniswap V2 signatures, computed
// independently of the ABI parser.
func TestEventTopicsMatchSignatures(t *testing.T) {
	cases := []struct {
		got  common.Hash
		sig  string
		name string
	}{
		{TopicPairCreated, "PairCreated(address,address,address,uint256)", "PairCreated"},
		{TopicMint, "Mint(address,uint256,uint256)", "Mint"},
		{TopicBurn, "Burn(address,uint256,uint256,address)", "Burn"},
		{TopicSwap, "Swap(address,uint256,uint256,uint256,uint256,address)", "Swap"},
		{TopicSync, "Sync(uint112,uint112)", "Sync"},
	}
	for _, c := range cases {
		if want := EventSignature(c.sig); c.got != want {
			t.Errorf("%s topic0 = %s, want %s", c.name, c.got, want)
		}
	}
}

// The real Swap topic0 on Ark devnet, observed on the deployed WKASH/mUSDC pair.
func TestSwapTopicMatchesDeployedChain(t *testing.T) {
	const observed = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822"
	if TopicSwap != common.HexToHash(observed) {
		t.Fatalf("Swap topic0 = %s, want the value observed on chain %s", TopicSwap, observed)
	}
}

func TestDecodeSwapReadsTopicsAndData(t *testing.T) {
	sender := common.HexToAddress("0xf2a7fd4072d70d2e7edf5a5eb653965cee0871b6")
	to := common.HexToAddress("0x4fea262782b5be34b18cf24b6ac026215899eec0")

	amounts := []*big.Int{
		big.NewInt(1_000_000_000_000_000_000), // amount0In
		big.NewInt(0),                          // amount1In
		big.NewInt(0),                          // amount0Out
		big.NewInt(921_977),                    // amount1Out
	}
	data, err := PairABI.Events["Swap"].Inputs.NonIndexed().Pack(amounts[0], amounts[1], amounts[2], amounts[3])
	if err != nil {
		t.Fatalf("pack: %v", err)
	}

	ev, err := DecodeSwap(types.Log{
		Topics: []common.Hash{TopicSwap, common.BytesToHash(sender.Bytes()), common.BytesToHash(to.Bytes())},
		Data:   data,
	})
	if err != nil {
		t.Fatalf("DecodeSwap: %v", err)
	}
	if ev.Sender != sender || ev.To != to {
		t.Fatalf("sender/to = %s/%s", ev.Sender, ev.To)
	}
	if ev.Amount0In.Cmp(amounts[0]) != 0 || ev.Amount1Out.Cmp(amounts[3]) != 0 {
		t.Fatalf("amounts decoded incorrectly: %+v", ev)
	}
}

func TestDecodeSyncReservesAreOrdered(t *testing.T) {
	// Real reserves from the deployed WKASH/mUSDC pair; too large for int64.
	r0, _ := new(big.Int).SetString("29215221934095211180", 10)
	r1 := big.NewInt(30816973)
	data, err := PairABI.Events["Sync"].Inputs.NonIndexed().Pack(r0, r1)
	if err != nil {
		t.Fatalf("pack: %v", err)
	}
	ev, err := DecodeSync(types.Log{Topics: []common.Hash{TopicSync}, Data: data})
	if err != nil {
		t.Fatalf("DecodeSync: %v", err)
	}
	if ev.Reserve0.Cmp(r0) != 0 || ev.Reserve1.Cmp(r1) != 0 {
		t.Fatalf("reserves = %v/%v, want %v/%v", ev.Reserve0, ev.Reserve1, r0, r1)
	}
}

// Malformed logs must error rather than produce zero-valued events that would
// silently enter the analytics tables.
func TestDecodersRejectMalformedLogs(t *testing.T) {
	if _, err := DecodeSwap(types.Log{Topics: []common.Hash{TopicSwap}}); err == nil {
		t.Error("DecodeSwap accepted a log with too few topics")
	}
	if _, err := DecodePairCreated(types.Log{Topics: []common.Hash{TopicPairCreated}}); err == nil {
		t.Error("DecodePairCreated accepted a log with too few topics")
	}
	if _, err := DecodeBurn(types.Log{Topics: []common.Hash{TopicBurn, {}, {}}, Data: []byte{1, 2}}); err == nil {
		t.Error("DecodeBurn accepted malformed data")
	}
}
