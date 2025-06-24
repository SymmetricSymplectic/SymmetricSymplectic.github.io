<?php
header('Content-Type: application/json');

// Configuración de conexión
$host = "146.190.57.35";
$user = "shakeapp";
$password = "J24_9xQRBzz8-DW";
$dbname = "ShakeDB";

$conn = new mysqli($host, $user, $password, $dbname);
if ($conn->connect_error) {
    http_response_code(500);
    echo json_encode(["error" => $conn->connect_error]);
    exit();
}

// Consulta (ajusta los nombres de columnas reales según tu tabla)
$sql = "SELECT * FROM eventos"; 
$result = $conn->query($sql);

$eventos = [];
$index = 1;
while ($row = $result->fetch_assoc()) {
    // Asignar coordenadas según columnas presentes
    if (!empty($row['latitud']) && !empty($row['longitud'])) {
        $coords = [floatval($row['latitud']), floatval($row['longitud'])];
    } elseif (!empty($row['coords'])) {
        $coord_parts = explode(',', $row['coords']);
        $coords = [floatval(trim($coord_parts[0])), floatval(trim($coord_parts[1]))];
    } else {
        $coords = [19.334842809698745, -99.14410548446263]; // CDMX por defecto
    }

    $eventos[] = [
        'id' => $row['id'] ?? $index,
        'titulo' => $row['titulo'] ?? $row['nombre'] ?? $row['title'] ?? 'Evento sin título',
        'fechaInicio' => $row['fechainicio'] ?? $row['fecha_inicio'] ?? $row['fecha'] ?? $row['startdate'] ?? $row['start_date'],
        'fechaFin' => $row['fechafin'] ?? $row['fecha_fin'] ?? $row['fechainicio'] ?? $row['fecha'],
        'horarios' => $row['horarios'] ?? $row['schedule'] ?? $row['horario'] ?? $row['time'] ?? 'Sin horarios especificados',
        'coords' => $coords,
        'direccion' => $row['direccion'] ?? $row['address'] ?? $row['ubicacion'] ?? 'Sin dirección',
        'descripcion' => $row['descripcion'] ?? $row['description'] ?? $row['desc'] ?? 'Sin descripción',
        'enlace' => $row['enlace'] ?? $row['link'] ?? $row['url'] ?? '#',
        'categoria' => $row['categoria'] ?? $row['category'] ?? 'default'
    ];
    $index++;
}

echo json_encode($eventos);
$conn->close();
?>
