<?php
// get_eventos.php - API mejorada para obtener eventos

// Incluir configuración
require_once '../shake/config.php';

// Configuración de headers para CORS y JSON
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Accept');

// Manejar preflight requests de CORS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Solo permitir GET requests
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['error' => true, 'message' => 'Método no permitido']);
    exit();
}

try {
    // Obtener conexión a la base de datos remota
    $pdo = getDatabase();
    
    // Log de conexión exitosa para debugging
    error_log("Conexión remota exitosa a ShakeDB en " . date('Y-m-d H:i:s'));
    
    // Preparar consulta SQL
    $sql = "SELECT 
                id,
                titulo,
                descripcion,
                fecha_inicio,
                fecha_fin,
                horarios,
                direccion,
                latitud,
                longitud,
                categoria,
                enlace,
                activo,
                fecha_creacion
            FROM eventos 
            WHERE activo = 1 
            ORDER BY fecha_inicio ASC, titulo ASC";
    
    $stmt = $pdo->prepare($sql);
    $stmt->execute();
    
    $eventos = [];
    
    while ($row = $stmt->fetch()) {
        // Validar coordenadas
        $latitud = floatval($row['latitud']);
        $longitud = floatval($row['longitud']);
        
        if ($latitud === 0.0 || $longitud === 0.0) {
            error_log("Evento ID {$row['id']} tiene coordenadas inválidas");
            continue; // Saltar eventos sin coordenadas válidas
        }
        
        // Formatear datos para el frontend
        $evento = [
            'id' => intval($row['id']),
            'titulo' => trim($row['titulo']),
            'descripcion' => trim($row['descripcion'] ?? ''),
            'fechaInicio' => $row['fecha_inicio'],
            'fechaFin' => $row['fecha_fin'],
            'horarios' => trim($row['horarios'] ?? ''),
            'direccion' => trim($row['direccion']),
            'coords' => [$latitud, $longitud],
            'categoria' => $row['categoria'],
            'enlace' => trim($row['enlace'] ?? ''),
            'fechaCreacion' => $row['fecha_creacion']
        ];
        
        $eventos[] = $evento;
    }
    
    // Log para debugging con información de conexión remota
    error_log("Enviando " . count($eventos) . " eventos desde ShakeDB remota al frontend");
    
    // Enviar respuesta exitosa
    echo json_encode($eventos, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    
} catch (PDOException $e) {
    // Error de base de datos
    error_log("Error de BD en get_eventos.php: " . $e->getMessage());
    http_response_code(500);
    echo json_encode([
        'error' => true,
        'message' => 'Error interno del servidor',
        'details' => 'Error de base de datos'
    ], JSON_UNESCAPED_UNICODE);
    
} catch (Exception $e) {
    // Error general
    error_log("Error general en get_eventos.php: " . $e->getMessage());
    http_response_code(500);
    echo json_encode([
        'error' => true,
        'message' => $e->getMessage()
    ], JSON_UNESCAPED_UNICODE);
}

// Cerrar conexión
$pdo = null;
?>