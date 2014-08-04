if (!String.prototype.contains) {
    String.prototype.contains = function () {
        return String.prototype.indexOf.apply(this, arguments) !== -1;
    };
}
if (!Array.prototype.contains) {
    Array.prototype.contains = function () {
        return Array.prototype.indexOf.apply(this, arguments) !== -1;
    };
}
if (!Object.prototype.isEmpty) {
    Object.prototype.isEmpty = function () {
        for (var key in this) {
            if (this.hasOwnProperty(key)) {
                return false;
            }
        }
        return true;
    };
}

if (!Array.prototype.equals) {
    Array.prototype.equals = function (array) {
        // if the other array is a falsy value, return
        if (!array)
            return false;

        // compare lengths - can save a lot of time
        if (this.length != array.length)
            return false;

        for (var i = 0, l = this.length; i < l; i++) {
            if (!this.contains(array[0])) {
                return false;
            }
        }
        return true;
    }
}