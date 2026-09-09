package chain

import (
	"bytes"
	"context"
	"strings"
	"unicode/utf8"

	"github.com/Emmyhack/ArkSwap/packages/gointernal/contracts"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/models"
)

// TokenMetadata reads name/symbol/decimals as defensively as possible.
//
// llm.txt s10 and s46 both apply here. A token is arbitrary code: it may revert
// on any of these calls, return `bytes32` instead of `string` (plenty of older
// tokens do), return nothing at all, or return deliberately misleading text.
//
// Two rules follow:
//
//   - A metadata failure never blocks indexing. The token is still recorded, with
//     MetadataComplete=false, so its pairs and swaps are captured and can be
//     backfilled later.
//   - Decimals are left nil when unreadable rather than defaulted to 18.
//     Assuming decimals silently misprices the token by orders of magnitude, and
//     everything derived from it — TVL, volume — inherits the error invisibly.
func (c *Client) TokenMetadata(ctx context.Context, address string) models.Token {
	t := models.Token{Address: models.NormalizeAddress(address)}

	if s, ok := c.stringCall(ctx, address, "name"); ok {
		t.Name = &s
	}
	if s, ok := c.stringCall(ctx, address, "symbol"); ok {
		t.Symbol = &s
	}
	if d, ok := c.decimalsCall(ctx, address); ok {
		t.Decimals = &d
	}

	t.MetadataComplete = t.Name != nil && t.Symbol != nil && t.Decimals != nil
	return t
}

// stringCall handles both `string` and `bytes32` return shapes.
func (c *Client) stringCall(ctx context.Context, address, method string) (string, bool) {
	data, err := contracts.ERC20ABI.Pack(method)
	if err != nil {
		return "", false
	}
	out, err := c.callContract(ctx, address, data)
	if err != nil || len(out) == 0 {
		return "", false
	}

	// Standard ABI-encoded string.
	if vals, err := contracts.ERC20ABI.Unpack(method, out); err == nil && len(vals) > 0 {
		if s, ok := vals[0].(string); ok {
			return sanitise(s)
		}
	}

	// Older tokens return a raw, right-padded bytes32.
	if len(out) == 32 {
		return sanitise(string(bytes.TrimRight(out, "\x00")))
	}
	return "", false
}

func (c *Client) decimalsCall(ctx context.Context, address string) (int, bool) {
	data, err := contracts.ERC20ABI.Pack("decimals")
	if err != nil {
		return 0, false
	}
	out, err := c.callContract(ctx, address, data)
	if err != nil || len(out) == 0 {
		return 0, false
	}
	vals, err := contracts.ERC20ABI.Unpack("decimals", out)
	if err != nil || len(vals) == 0 {
		return 0, false
	}
	switch v := vals[0].(type) {
	case uint8:
		return int(v), true
	}
	return 0, false
}

// sanitise rejects metadata that is not valid, printable UTF-8.
//
// Symbols are rendered in a UI and used in logs. A token that returns control
// characters or invalid bytes is treated as having no readable symbol rather
// than being allowed to inject them downstream; it is still indexed.
func sanitise(s string) (string, bool) {
	s = strings.TrimSpace(s)
	if s == "" || !utf8.ValidString(s) {
		return "", false
	}
	for _, r := range s {
		if r < 0x20 || r == 0x7f {
			return "", false
		}
	}
	const maxLen = 128
	if len(s) > maxLen {
		s = s[:maxLen]
	}
	return s, true
}
