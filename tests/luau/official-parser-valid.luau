--!strict
type Point = { x: number, y: number }

local function magnitude(point: Point): number
    local total = point.x * point.x + point.y * point.y
    return math.sqrt(total)
end

local values = { 3, 4, 5 }
local sum = 0
for _, value in values do
    sum += value
end

if sum > 0 then
    print(magnitude({ x = 3, y = 4 }))
end
