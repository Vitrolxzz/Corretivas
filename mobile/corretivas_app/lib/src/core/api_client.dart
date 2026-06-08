import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ApiClient {
  ApiClient({required this.baseUrl, required this.operatorName});

  final String baseUrl;
  final String operatorName;

  ApiClient forOperator(String name) =>
      ApiClient(baseUrl: baseUrl, operatorName: name);

  Future<Map<String, dynamic>> get(String path) async {
    return _send('GET', path);
  }

  Future<Map<String, dynamic>> post(
      String path, Map<String, dynamic> body) async {
    return _send('POST', path, body: body);
  }

  Future<Map<String, dynamic>> put(
      String path, Map<String, dynamic> body) async {
    return _send('PUT', path, body: body);
  }

  Future<void> delete(String path) async {
    await _send('DELETE', path);
  }

  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final headers = <String, String>{
      'Content-Type': 'application/json',
      'X-Corretivas-Mobile': 'true',
      'X-Operator-Name': operatorName.trim(),
    };

    final uri = Uri.parse('$baseUrl/api/v1$path');
    final request = http.Request(method, uri)..headers.addAll(headers);

    if (body != null) {
      request.body = jsonEncode(body);
    }

    final response = await http.Response.fromStream(
        await request.send().timeout(const Duration(seconds: 25)));
    final decoded = response.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(response.body) as Map<String, dynamic>;

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(
          decoded['error']?.toString() ?? 'Falha na comunicacao com a API.');
    }

    return decoded;
  }

  Stream<Map<String, dynamic>> events() async* {
    final request =
        http.Request('GET', Uri.parse('$baseUrl/api/v1/sync/events'));
    request.headers['X-Corretivas-Mobile'] = 'true';
    request.headers['X-Operator-Name'] = operatorName.trim();

    final response = await request.send();

    if (response.statusCode != 200) {
      throw ApiException('Nao foi possivel abrir sincronizacao em tempo real.');
    }

    await for (final line in response.stream
        .transform(utf8.decoder)
        .transform(const LineSplitter())) {
      if (line.startsWith('data: ')) {
        final text = line.substring(6);
        if (text.trim().isNotEmpty) {
          yield jsonDecode(text) as Map<String, dynamic>;
        }
      }
    }
  }
}

bool isOfflineError(Object error) {
  return error is SocketException ||
      error is TimeoutException ||
      error is http.ClientException;
}

String apiErrorMessage(Object error) {
  if (error is ApiException) {
    return error.message;
  }

  return error.toString();
}

class OfflineQueue {
  static const _key = 'offline_queue';

  Future<void> enqueue(String method, String path, Map<String, dynamic>? body,
      {required String operatorName}) async {
    final prefs = await SharedPreferences.getInstance();
    final queue = prefs.getStringList(_key) ?? <String>[];
    queue.add(jsonEncode({
      'method': method,
      'path': path,
      'body': body,
      'operatorName': operatorName,
      'createdAt': DateTime.now().toIso8601String(),
    }));
    await prefs.setStringList(_key, queue);
  }

  Future<int> flush(ApiClient api) async {
    final prefs = await SharedPreferences.getInstance();
    final queue = prefs.getStringList(_key) ?? <String>[];
    final remaining = <String>[];
    var synced = 0;

    for (final item in queue) {
      final entry = jsonDecode(item) as Map<String, dynamic>;

      try {
        final method = entry['method'] as String;
        final path = entry['path'] as String;
        final body = entry['body'] as Map<String, dynamic>?;
        final operatorName = entry['operatorName']?.toString();
        final requestApi = operatorName == null || operatorName.trim().isEmpty
            ? api
            : api.forOperator(operatorName);

        if (method == 'POST') {
          await requestApi.post(path, body ?? {});
        } else if (method == 'PUT') {
          await requestApi.put(path, body ?? {});
        } else if (method == 'DELETE') {
          await requestApi.delete(path);
        }

        synced += 1;
      } catch (error) {
        if (!isOfflineError(error)) {
          rethrow;
        }

        remaining.add(item);
      }
    }

    await prefs.setStringList(_key, remaining);
    return synced;
  }
}

class ApiException implements Exception {
  ApiException(this.message);
  final String message;

  @override
  String toString() => message;
}
