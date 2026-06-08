import 'package:flutter/material.dart';

class CorretivasTheme {
  static const background = Color(0xFF0F1013);
  static const panel = Color(0xFF17191F);
  static const panelSoft = Color(0xFF13151A);
  static const line = Color(0xFF303642);
  static const text = Color(0xFFF4F6F8);
  static const muted = Color(0xFF9CA6B8);
  static const accent = Color(0xFF32D3B4);
  static const danger = Color(0xFFF26475);
  static const amber = Color(0xFFF4C665);

  static ThemeData dark() {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: background,
      colorScheme: const ColorScheme.dark(
        primary: accent,
        secondary: accent,
        surface: panel,
        error: danger,
      ),
      cardTheme: const CardThemeData(
        color: panel,
        elevation: 0,
        shape: RoundedRectangleBorder(
          side: BorderSide(color: line),
          borderRadius: BorderRadius.all(Radius.circular(8)),
        ),
      ),
      inputDecorationTheme: const InputDecorationTheme(
        filled: true,
        fillColor: Color(0xFF0F1217),
        border: OutlineInputBorder(
            borderRadius: BorderRadius.all(Radius.circular(7))),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(7)),
          borderSide: BorderSide(color: line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(7)),
          borderSide: BorderSide(color: accent),
        ),
      ),
    );
  }
}
