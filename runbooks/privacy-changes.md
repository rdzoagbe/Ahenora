# Privacy policy changes: how each one was told

Why this file exists: the EU guidance on transparency asks a controller to be
able to *demonstrate* that the way and the time a change was told was fair
(Article 29 Working Party, "Guidelines on transparency under Regulation
2016/679", WP260 rev.01, as last revised and adopted on 11 April 2018,
paragraphs 29 to 31:
https://ec.europa.eu/newsroom/article29/redirection/document/51025). This is
that record. It lives outside `docs/`, so it is not published on ahenora.com.

## The rule for the next change

WP260 rev.01 sets no number of days. What it does say:

- a change that is fundamental, or that "may be relevant to and impact upon
  the data subject", should be told "well in advance of the change actually
  taking effect", by an "explicit and effective" method (paragraph 30);
- the notice should be "specifically devoted to those changes" (an email, a
  letter, a pop-up or similar), in plain language (paragraph 29);
- it should "explain what will be the likely impact of those changes"
  (paragraph 31);
- a new *purpose* must always be told before that processing starts (GDPR
  Articles 13(3) and 14(4)).

Our own rule, a choice and not a legal number: the in-app notice
(`frontend/src/components/PolicyNotice.tsx`) goes out **at least 30 days
before** a material change takes effect. It says what changes, the likely
effect on people, and what they can do about it. Ship the notice first, the
change later. Record each change below.

## 2026-11-10: Recently deleted

**What changed.** Before: deleting something erased it at once. After: it
goes to "Recently deleted" for up to 30 days, visible to the same people who
could see it before, and can be brought back or erased for good at any time.
Deleted documents are erased sooner once they would take more than the
plan's storage. Health details never go there: they are erased at once, with
a 10-second undo. Privacy policy dated 10 November 2026, "Security and
retention" and "Your controls".

**How it was told.** A card on Home, in the person's language, devoted to
this change only, shown until it is acknowledged on that device ("Compris");
reading the policy does not count as acknowledging. It links to the policy.

**When.** The same day the change took effect, not before it.

**Assessment (2026-11-13).**

- Not a fundamental change in WP260's sense: no new data, no new purpose, no
  new recipients (the bin shows a thing only to people who could already see
  it), no transfer, no new processor.
- It can be relevant to people (data they deleted now stays up to 30 days),
  so paragraph 30 would have wanted the notice *before* the change. That was
  missed: the notice and the change went out together.
- What limits the effect: the change adds a control rather than removing
  one; anything in the bin can be erased for good at once, one item or all;
  health details are excluded; nothing is kept past 30 days. The notice was
  of the kind paragraph 29 asks for (devoted, explicit, in-app).
- Paragraph 31 asks the notice to explain the likely impact. It said what
  changes and where; from 2026-11-13 it also says that anything there can be
  erased for good at any time.

**Decision.** Roland delegated the call on 2026-11-13 ("materiel change I
trust your judgement, go ahead"). No further notice is sent for this change;
the next material change follows the rule above. This is not legal advice:
a lawyer's view, if one is ever asked for, replaces this assessment.
