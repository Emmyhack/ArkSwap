package chain

import "testing"

func TestSanitiseRejectsUnprintableMetadata(t *testing.T) {
	good := []string{"mUSDC", "Mock USD Coin (Ark Devnet)", "WKASH"}
	for _, s := range good {
		if got, ok := sanitise(s); !ok || got != s {
			t.Errorf("sanitise(%q) = %q,%v; want it accepted unchanged", s, got, ok)
		}
	}

	bad := []string{
		"",
		"   ",
		"bad\x00name",
		"line\nbreak",
		"\x1b[31mred",
		string([]byte{0xff, 0xfe}),
	}
	for _, s := range bad {
		if _, ok := sanitise(s); ok {
			t.Errorf("sanitise(%q) accepted unprintable/invalid metadata", s)
		}
	}
}

func TestSanitiseTrimsAndCaps(t *testing.T) {
	if got, _ := sanitise("  spaced  "); got != "spaced" {
		t.Errorf("got %q", got)
	}
	long := make([]byte, 300)
	for i := range long {
		long[i] = 'a'
	}
	got, ok := sanitise(string(long))
	if !ok || len(got) != 128 {
		t.Errorf("len = %d, ok = %v; want a 128-byte cap", len(got), ok)
	}
}
