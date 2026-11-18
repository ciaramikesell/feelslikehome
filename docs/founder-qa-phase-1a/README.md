# Founder QA Phase 1A

The welcome puts the FLH wordmark and cottage first, then introduces listing import in two lines of copy. The practice example shows a confirmed detail and an unknown detail using a fictional listing.

## Before and after

Each comparison shows the welcome, listing, Share Sheet, and both Match selections. All dimensions are CSS pixels.

| Viewport | Screenshots |
| --- | --- |
| 320 × 568 | [Before and after](320.jpg) |
| 375 × 667 | [Before and after](375.jpg) |
| 390 × 844 | [Before and after](390.jpg) |
| 430 × 932 | [Before and after](430.jpg) |
| 1440 × 900 | [Native-shell content in a desktop viewport](1440.jpg) |
| 320 × 568, 200% root text size | [Before and after](320-large.jpg) |
| 375 × 500, simulated 47 px top and 34 px bottom insets | [Before and after](375-short-safe.jpg) |
| 1440 × 900, ordinary browser | [Pixel-identical public landing capture](desktop-public.jpg) |

Captured in Chromium using a simulated Capacitor bridge and local copies of the site's fonts. The short-viewport and large-text comparisons include a capture of the action area after scrolling. The welcome and tutorial have no text fields that invoke the keyboard.

## Founder review on TestFlight

- [ ] Check the welcome on a short iPhone, then repeat at a larger accessibility text size. Check the wordmark, cottage crop, and reachability of Get Started and Sign in.
- [ ] Open **See how it works**, tap **Share**, choose **Feels Like Home**, and switch between **Kitchen Island** and **Soaking Tub**. Check that the result makes confirmed and unknown details easy to distinguish.
- [ ] Try **Back**, **Skip**, **Close**, **Done**, and **Practice Again**. Open the tutorial again from Account Help and check that closing it returns you to Account.
- [ ] Check that **Get Started** opens sign-up and **Sign in** opens sign-in. Try sharing a listing from Safari through the real Share Extension as a device smoke test.
