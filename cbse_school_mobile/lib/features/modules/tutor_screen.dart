import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";

import "../../core/api/api_client.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "../../core/ui/motion.dart";
import "../../core/ui/spacing.dart";

/// What the tutor is told about the child and, when opened from a
/// homework item, the assignment.
class TutorContext {
  const TutorContext({
    required this.child,
    this.subjectLabel = "",
    this.homeworkTitle = "",
    this.homeworkBody = "",
  });

  final ParentChild child;
  final String subjectLabel;
  final String homeworkTitle;
  final String homeworkBody;

  Map<String, String> toJson() => {
    "childName": child.fullName,
    "className": [
      child.className,
      if (child.sectionName.isNotEmpty) child.sectionName,
    ].join(" "),
    if (subjectLabel.isNotEmpty) "subjectLabel": subjectLabel,
    if (homeworkTitle.isNotEmpty) "homeworkTitle": homeworkTitle,
    if (homeworkBody.isNotEmpty) "homeworkBody": homeworkBody,
  };
}

/// The AI tutor for parents. Hints are free (a daily allowance); the full
/// tutor — teaching, examples, practice, checking answers, homework help,
/// exam prep — runs for the length of a pass. Replies stream in as the
/// tutor writes them.
class TutorScreen extends StatefulWidget {
  const TutorScreen({
    super.key,
    required this.api,
    required this.context,
    this.initialMode = "hint",
  });

  final ApiClient api;
  final TutorContext context;
  final String initialMode;

  @override
  State<TutorScreen> createState() => _TutorScreenState();
}

class _Msg {
  _Msg(this.role, this.text, {this.mode = ""});

  final String role;
  String text;
  final String mode;
  String charge = "";
}

class _TutorScreenState extends State<TutorScreen> {
  TutorStatus? _status;
  String? _error;
  late String _mode = widget.initialMode;
  final _messages = <_Msg>[];
  final _input = TextEditingController();
  final _scroll = ScrollController();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final s = await widget.api.fetchTutorStatus();
      if (!mounted) return;
      setState(() => _status = s);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = "Could not reach the school server.");
      }
    }
  }

  TutorModeInfo? get _modeInfo {
    final s = _status;
    if (s == null) return null;
    for (final m in s.modes) {
      if (m.code == _mode) return m;
    }
    return s.modes.isEmpty ? null : s.modes.first;
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: AppMotion.base,
        curve: AppMotion.enter,
      );
    });
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    final status = _status;
    if (text.isEmpty || _busy || status == null) return;
    final mode = _modeInfo;
    // A paid mode without a pass is refused by the server; say so before
    // the round trip and open the passes instead.
    if (mode != null && mode.paid && !status.allowance.hasPass) {
      Haptics.warning();
      _showPasses(
        reason:
            "${mode.label} is part of the full tutor. Get a pass — a day, a week or a month — to unlock it.",
      );
      return;
    }
    Haptics.tap();
    _input.clear();
    final history = [
      for (final m in _messages.where((m) => m.text.isNotEmpty))
        TutorTurn(m.role, m.text),
    ];
    final reply = _Msg("assistant", "", mode: _mode);
    setState(() {
      _busy = true;
      _messages.add(_Msg("user", text, mode: _mode));
      _messages.add(reply);
    });
    _scrollToEnd();
    try {
      await for (final ev in widget.api.askTutorStream(
        message: text,
        mode: _mode,
        history: history,
        context: widget.context.toJson(),
        studentId: widget.context.child.id,
      )) {
        if (!mounted) return;
        switch (ev) {
          case TutorDelta(:final text):
            setState(() => reply.text += text);
            _scrollToEnd();
          case TutorDone(reply: final full, :final charge, :final allowance):
            setState(() {
              if (full.isNotEmpty) reply.text = full;
              reply.charge = charge;
              if (allowance != null) {
                _status = _withAllowance(status, allowance);
              }
            });
        }
      }
      Haptics.success();
    } on TutorRefused catch (e) {
      Haptics.warning();
      if (!mounted) return;
      setState(() {
        _messages.removeLast();
        if (e.allowance != null) _status = _withAllowance(status, e.allowance!);
      });
      if (e.needsPass) {
        _showPasses(reason: e.message);
      } else {
        _toast(e.message);
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _messages.removeLast());
      _toast(e.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _messages.removeLast());
      _toast("Could not reach the tutor. Check your connection.");
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  TutorStatus _withAllowance(TutorStatus s, TutorAllowance a) => TutorStatus(
    configured: s.configured,
    modes: s.modes,
    allowance: a,
    plans: s.plans,
    orders: s.orders,
    note: s.note,
  );

  void _toast(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _showPasses({String? reason}) async {
    final status = _status;
    if (status == null) return;
    final bought = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) =>
          _PassSheet(api: widget.api, status: status, reason: reason),
    );
    if (bought == true) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final status = _status;
    final child = widget.context.child;
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text("AI tutor", style: TextStyle(fontSize: 16)),
            Text(
              widget.context.homeworkTitle.isNotEmpty
                  ? widget.context.homeworkTitle
                  : child.fullName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11, color: Color(0xFFB8C0D4)),
            ),
          ],
        ),
        actions: [
          if (status != null)
            TextButton.icon(
              onPressed: () => _showPasses(),
              icon: const Icon(Icons.workspace_premium_outlined, size: 18),
              label: Text(
                status.allowance.hasPass
                    ? status.allowance.validLabel
                    : "Get a pass",
              ),
              style: TextButton.styleFrom(foregroundColor: Colors.white),
            ),
        ],
      ),
      body: AppCrossfade(
        child: status == null
            ? Center(
                key: ValueKey(_error == null ? "loading" : "error"),
                child: _error == null
                    ? const CircularProgressIndicator(color: AppColors.primary)
                    : Padding(
                        padding: Insets.state,
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(
                              Icons.cloud_off_outlined,
                              size: 40,
                              color: AppColors.muted,
                            ),
                            const SizedBox(height: Space.md),
                            Text(_error!, textAlign: TextAlign.center),
                            const SizedBox(height: Space.md),
                            FilledButton(
                              onPressed: _load,
                              child: const Text("Retry"),
                            ),
                          ],
                        ),
                      ),
              )
            : !status.configured
            ? Center(
                key: const ValueKey("off"),
                child: Padding(
                  padding: Insets.state,
                  child: const Text(
                    "The tutor is not switched on yet. Please check back later.",
                    textAlign: TextAlign.center,
                  ),
                ),
              )
            : Column(
                key: const ValueKey("chat"),
                children: [
                  _ModeBar(
                    modes: status.modes,
                    selected: _mode,
                    hasPass: status.allowance.hasPass,
                    onSelect: (code) {
                      if (code == _mode) return;
                      Haptics.tap();
                      setState(() => _mode = code);
                    },
                  ),
                  _AllowanceStrip(allowance: status.allowance, mode: _modeInfo),
                  Expanded(
                    child: _messages.isEmpty
                        ? _Welcome(mode: _modeInfo, note: status.note)
                        : ListView.builder(
                            controller: _scroll,
                            padding: const EdgeInsets.fromLTRB(
                              Space.lg,
                              Space.md,
                              Space.md,
                              Space.xl,
                            ),
                            itemCount: _messages.length,
                            itemBuilder: (context, i) => _Bubble(
                              msg: _messages[i],
                              busy: _busy && i == _messages.length - 1,
                            ),
                          ),
                  ),
                  _Composer(
                    controller: _input,
                    hint: _modeInfo?.prompt ?? "Ask the tutor…",
                    busy: _busy,
                    onSend: _send,
                  ),
                ],
              ),
      ),
    );
  }
}

class _ModeBar extends StatelessWidget {
  const _ModeBar({
    required this.modes,
    required this.selected,
    required this.hasPass,
    required this.onSelect,
  });

  final List<TutorModeInfo> modes;
  final String selected;
  final bool hasPass;
  final void Function(String code) onSelect;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 46,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(Space.lg, Space.sm, Space.md, 0),
        itemCount: modes.length,
        separatorBuilder: (_, _) => const SizedBox(width: Space.sm),
        itemBuilder: (context, i) {
          final m = modes[i];
          final on = m.code == selected;
          final locked = m.paid && !hasPass;
          return AnimatedContainer(
            duration: AppMotion.fast,
            decoration: BoxDecoration(
              color: on ? AppColors.primary : Colors.white,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(
                color: on
                    ? AppColors.primary
                    : AppColors.ink.withValues(alpha: 0.12),
              ),
            ),
            clipBehavior: Clip.antiAlias,
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: () => onSelect(m.code),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 8,
                  ),
                  child: Row(
                    children: [
                      if (locked) ...[
                        Icon(
                          Icons.lock_outline,
                          size: 13,
                          color: on ? Colors.white70 : AppColors.muted,
                        ),
                        const SizedBox(width: 4),
                      ],
                      Text(
                        m.label,
                        style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                          color: on ? Colors.white : AppColors.ink,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _AllowanceStrip extends StatelessWidget {
  const _AllowanceStrip({required this.allowance, required this.mode});

  final TutorAllowance allowance;
  final TutorModeInfo? mode;

  @override
  Widget build(BuildContext context) {
    final String text;
    if (allowance.hasPass) {
      text =
          "Full tutor on · ${allowance.validLabel}"
          "${allowance.passUsedToday >= allowance.passMessagesPerDay ? " · today's limit reached" : ""}";
    } else if (mode != null && mode!.paid) {
      text = "${mode!.label} needs a pass — hints stay free";
    } else {
      text =
          "${allowance.freeLeft} of ${allowance.freeHintsPerDay} free hints left today";
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        Space.xl,
        Space.sm,
        Space.lg,
        Space.xs,
      ),
      child: Row(
        children: [
          Icon(
            allowance.hasPass ? Icons.verified_outlined : Icons.info_outline,
            size: 14,
            color: allowance.hasPass ? AppColors.success : AppColors.muted,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                fontSize: 11.5,
                color: allowance.hasPass ? AppColors.success : AppColors.muted,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Welcome extends StatelessWidget {
  const _Welcome({required this.mode, required this.note});

  final TutorModeInfo? mode;
  final String note;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: Insets.page,
      children: [
        Container(
          padding: Insets.card,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.ink.withValues(alpha: 0.08)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                mode?.label ?? "Tutor",
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: Space.xs),
              Text(
                mode?.blurb ?? "",
                style: const TextStyle(
                  fontSize: 13,
                  color: AppColors.ink,
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: Space.lg),
        Text(
          note,
          style: const TextStyle(
            fontSize: 12,
            color: AppColors.muted,
            height: 1.45,
          ),
        ),
        const SizedBox(height: Space.sm),
        const Text(
          "Replies are written by an AI and can be wrong. Check anything that matters with the class teacher.",
          style: TextStyle(fontSize: 12, color: AppColors.muted, height: 1.45),
        ),
      ],
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.msg, required this.busy});

  final _Msg msg;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final mine = msg.role == "user";
    final waiting = !mine && msg.text.isEmpty && busy;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * 0.82,
        ),
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.fromLTRB(14, 10, 12, 10),
        decoration: BoxDecoration(
          color: mine ? AppColors.primary : Colors.white,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(mine ? 16 : 4),
            bottomRight: Radius.circular(mine ? 4 : 16),
          ),
          border: mine
              ? null
              : Border.all(color: AppColors.ink.withValues(alpha: 0.08)),
        ),
        child: waiting
            ? const SizedBox(
                width: 36,
                height: 14,
                child: Center(
                  child: SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: AppColors.muted,
                    ),
                  ),
                ),
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SelectableText(
                    // The model is asked for plain text but still bolds with
                    // asterisks now and then; a parent should never see them.
                    msg.text.replaceAll("**", ""),
                    style: TextStyle(
                      fontSize: 13.5,
                      height: 1.45,
                      color: mine ? Colors.white : AppColors.ink,
                    ),
                  ),
                  if (!mine && msg.charge.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      msg.charge == "free" ? "Free hint" : "Full tutor",
                      style: const TextStyle(
                        fontSize: 10,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ],
              ),
      ),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.hint,
    required this.busy,
    required this.onSend,
  });

  final TextEditingController controller;
  final String hint;
  final bool busy;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          Space.md,
          Space.sm,
          Space.md,
          Space.md,
        ),
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: controller,
                minLines: 1,
                maxLines: 5,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => onSend(),
                decoration: InputDecoration(
                  hintText: hint,
                  filled: true,
                  fillColor: Colors.white,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 10,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide.none,
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
            ),
            const SizedBox(width: Space.sm),
            IconButton.filled(
              onPressed: busy ? null : onSend,
              style: IconButton.styleFrom(backgroundColor: AppColors.primary),
              icon: busy
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.arrow_upward, color: Colors.white),
            ),
          ],
        ),
      ),
    );
  }
}

/// The passes on sale. Buying opens the school's payment page; the pass
/// switches on by itself once the bank confirms.
class _PassSheet extends StatefulWidget {
  const _PassSheet({required this.api, required this.status, this.reason});

  final ApiClient api;
  final TutorStatus status;
  final String? reason;

  @override
  State<_PassSheet> createState() => _PassSheetState();
}

class _PassSheetState extends State<_PassSheet> {
  String? _buying;

  Future<void> _buy(TutorPlanInfo plan) async {
    if (_buying != null) return;
    setState(() => _buying = plan.code);
    try {
      final r = await widget.api.buyTutorPass(plan.code);
      final uri = Uri.tryParse(r.checkoutUrl);
      if (uri == null) {
        throw ApiException("Could not open the payment page", 502);
      }
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened) {
        throw ApiException("No browser available to open the payment page", 0);
      }
      Haptics.success();
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      Haptics.warning();
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Could not reach the school server.")),
        );
      }
    } finally {
      if (mounted) setState(() => _buying = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.status.allowance;
    final pending = widget.status.orders
        .where((o) => o.status == "pending")
        .toList();
    return SafeArea(
      child: Padding(
        padding: Insets.sheet,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              "Tutor pass",
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w700,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: Space.xs),
            Text(
              widget.reason ??
                  "Unlock the full tutor for your whole family — teaching, worked examples, practice questions, answer checking, homework help and exam preparation.",
              style: const TextStyle(
                fontSize: 13,
                color: AppColors.ink,
                height: 1.45,
              ),
            ),
            if (a.hasPass) ...[
              const SizedBox(height: Space.md),
              Row(
                children: [
                  const Icon(
                    Icons.verified,
                    size: 16,
                    color: AppColors.success,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    "${a.passPlanLabel.isNotEmpty ? "${a.passPlanLabel} pass · " : ""}${a.validLabel}. A new pass starts when this one ends.",
                    style: const TextStyle(
                      fontSize: 12.5,
                      color: AppColors.success,
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: Space.lg),
            for (final p in widget.status.plans) ...[
              _PlanTile(
                plan: p,
                busy: _buying == p.code,
                enabled: _buying == null,
                onTap: () => _buy(p),
              ),
              const SizedBox(height: Space.sm),
            ],
            if (pending.isNotEmpty) ...[
              const SizedBox(height: Space.sm),
              Text(
                "Waiting for the bank: ${pending.map((o) => "${o.days}-day pass (${o.amountLabel})").join(", ")}. The pass switches on by itself once the payment is confirmed.",
                style: const TextStyle(
                  fontSize: 12,
                  color: AppColors.muted,
                  height: 1.4,
                ),
              ),
            ],
            const SizedBox(height: Space.sm),
            const Text(
              "Fair use: up to 60 tutor messages a day on a pass. Hints stay free every day.",
              style: TextStyle(
                fontSize: 11.5,
                color: AppColors.muted,
                height: 1.4,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PlanTile extends StatelessWidget {
  const _PlanTile({
    required this.plan,
    required this.busy,
    required this.enabled,
    required this.onTap,
  });

  final TutorPlanInfo plan;
  final bool busy;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: enabled ? onTap : null,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      plan.label,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppColors.ink,
                      ),
                    ),
                    Text(
                      "Full tutor for ${plan.days == 1 ? "one day" : "${plan.days} days"}",
                      style: const TextStyle(
                        fontSize: 11.5,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
              if (busy)
                const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else
                Text(
                  plan.priceLabel,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primary,
                  ),
                ),
              const SizedBox(width: 6),
              const Icon(Icons.chevron_right, color: AppColors.muted),
            ],
          ),
        ),
      ),
    );
  }
}
