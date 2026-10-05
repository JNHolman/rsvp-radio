import unittest
import numpy as np

from analyzer.rsvp_audio_analyzer import (
    AdaptiveLevel,
    choose_monitor_source,
    parse_sources,
    spectral_levels,
    validate_features_url,
)


class AnalyzerTests(unittest.TestCase):
    def test_monitor_prefers_default_sink_monitor(self):
        sources = parse_sources("1\talsa_input.usb\tmodule\n2\tbluez_output.foo.monitor\tmodule\n3\tmain.monitor\tmodule")
        self.assertEqual(choose_monitor_source(sources, default_sink="main"), "main.monitor")

    def test_monitor_override_can_match_by_substring(self):
        self.assertEqual(choose_monitor_source(["alpha.monitor", "secondary_output.monitor"], override="secondary"), "secondary_output.monitor")

    def test_fft_normalization_is_not_chunk_size_dependent(self):
        def tone(frames):
            t = np.arange(frames) / 48000.0
            mono = (0.08 * np.sin(2 * np.pi * 80 * t)).astype(np.float32)
            return np.column_stack([mono, mono]).ravel()
        b1, _ = spectral_levels(tone(4096), channels=2)
        b2, _ = spectral_levels(tone(8192), channels=2)
        self.assertGreater(b1, 0)
        self.assertAlmostEqual(b1, b2, delta=max(b1, b2) * 0.08)

    def test_bass_tone_scores_higher_in_bass_than_treble_tone(self):
        t = np.arange(4096) / 48000.0
        bass = np.column_stack([0.08*np.sin(2*np.pi*80*t)]*2).astype(np.float32).ravel()
        treble = np.column_stack([0.08*np.sin(2*np.pi*2000*t)]*2).astype(np.float32).ravel()
        bass_score, _ = spectral_levels(bass)
        treble_bass_score, _ = spectral_levels(treble)
        self.assertGreater(bass_score, treble_bass_score * 10)

    def test_adaptive_level_stays_bounded_and_releases(self):
        level = AdaptiveLevel(floor=0.001, peak=0.01)
        high = level.update(0.02)
        self.assertGreater(high, 0)
        for _ in range(50):
            low = level.update(0.0)
        self.assertGreaterEqual(low, 0)
        self.assertLessEqual(low, 1)
        self.assertLess(low, high)

    def test_features_url_is_loopback_only(self):
        self.assertEqual(validate_features_url("http://127.0.0.1:3000/features"), "http://127.0.0.1:3000/features")
        with self.assertRaises(ValueError):
            validate_features_url("https://example.com/features")
        with self.assertRaises(ValueError):
            validate_features_url("http://127.0.0.1:3000/admin/lights/on")
        with self.assertRaises(ValueError):
            validate_features_url("http://127.0.0.1:3000/features?x=1")


if __name__ == "__main__":
    unittest.main()